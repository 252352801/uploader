import md5 from 'js-md5'
const blobSlice = (() => {
  return (
    File.prototype.slice ||
    File.prototype.mozSlice ||
    File.prototype.webkitSlice
  )
})()
/**
 * 文件md5处理，返回值用于验证文件完整性
 * @description 依赖 SparkMD5
 * @param {File} file 文件对象
 * @returns {string} md5File
 */
function MD5file (file) {
  return new Promise((resolve, reject) => {
    const fileReader = new FileReader()
    fileReader.readAsArrayBuffer(blobSlice.call(file))
    fileReader.onload = function (e) {
      resolve(md5(e.target.result))
    }
    fileReader.onerror = function () {
      reject(new Error('ReadAsArrayBuffer error!'))
    }
  })
}
/**
 * 是否是非空对象
 * @param {*} val
 * @returns boolean
 */
function isObj (val) {
  return val && typeof val === 'object'
}
/**
 * 是否是函数
 * @param {*} fn
 * @returns boolean
 */
function isFn (fn) {
  return typeof fn === 'function'
}
/**
 * 是否是Promise
 * @param {*} p
 * @returns {boolean}
 */
function isPromise (p) {
  return (isObj(p) || isFn(p)) && isFn(p.then)
}
/**
 * 是否是input元素
 */
function isInputElem (elem) {
  return elem
}
/**
 *文件分块
 * @param {File} file
 * @param {number} chunkSize 分块大小
 * @returns {Number}
 */
function sliceFile (file, chunkSize) {
  if (file instanceof File) {
    const count = Math.ceil(file.size / chunkSize)
    const chunks = []
    let i = 0
    while (i < count) {
      let start = i * chunkSize
      let end = start + chunkSize >= file.size ? file.size : start + chunkSize
      chunks.push(blobSlice.call(file, start, end))
      i++
    }
    return chunks
  }
}
/** 队列文件状态 */
const QF_STATUS = {
  pending: 'pending',
  reay: 'ready',
  hashing: 'hashing',
  hashed: 'hashed',
  chunking: 'chunking',
  chunked: 'chunked',
  checking: 'checking',
  checked: 'checked',
  uploading: 'uploading',
  abort: 'abort',
  success: 'success',
  error: 'error'
}
/**
 * 获取队列文件状态文字
 * @param {string} staus
 */
function getQFStatusText (status) {
  return {
    pending: '等待上传',
    reay: '准备就绪',
    hashing: '正在计算hash值',
    hashed: '计算hash值完成',
    chunking: '正在进行文件分块',
    chunked: '文件分块完成',
    checking: '检测文件状态',
    checked: '检测文件状态完成',
    uploading: '正在上传',
    abort: '已中断',
    success: '上传成功',
    error: '上传失败'
  }[status] || ''
}
/** 上传类型 */
const UPLOAD_TYPE = {
  concurrent: 0, // 并发上传
  serial: 1 // 串行上传
}

function upload (opts) {
  // opts = {
  //   name: '',
  //   file: null,
  //   headers: {},
  //   data: {},
  //   url: '',
  //   progress: () => {},
  //   success: () => {},
  //   error: () => {},
  //   withCredentials: false
  // }
  const xhr = new XMLHttpRequest()
  const fd = new FormData()
  fd.append(opts.name, opts.file)
  const data = opts.data
  if (isObj(data)) {
    for (let o in data) {
      fd.append(o, data[o])
    }
  }
  xhr.open('POST', opts.url)
  // 请求头设置
  if (opts.headers) {
    for (let o in opts.headers) {
      xhr.setRequestHeader(o, opts.headers[o])
    }
  }
  if (opts.withCredentials !== undefined) {
    xhr.setRequestHeader('withCredentials', opts.withCredentials)
  }
  xhr.upload.onprogress = ev => {
    if (isFn(opts.progress)) {
      opts.progress.call(this, ev)
    }
  }

  xhr.onload = ev => {
    if (!((xhr.status >= 200 && xhr.status < 300) || xhr.status === 304)) {
      if (isFn(opts.error)) {
        opts.error(ev)
      }
    } else {
      if (isFn(opts.success)) {
        const isResJson = xhr.getResponseHeader('Content-type').indexOf('application/json') >= 0
        let res = xhr.responseText
        if (isResJson) {
          try {
            res = JSON.parse(res)
          } catch (err) {
            throw new Error(err)
          }
        }
        opts.success(res)
      }
    }
  }
  xhr.onerror = (ev) => {
    if (isFn(opts.error)) {
      opts.error(ev)
    }
  }
  xhr.send(fd)
  return xhr
}

export class UploadEvent {
  handlersMap = {
    // evName: []
  }
  static events = {
    select: 'select',
    onCountExceed: 'onCountExceed',
    onSizeExceed: 'onSizeExceed',
    beforeRemove: 'beforeRemove',
    remove: 'remove',
    beforeChunk: 'beforeChunk',
    afterChunk: 'afterChunk',
    beforeHash: 'beforeHash',
    afterHash: 'afterHash',
    beforeChunkUpload: 'beforeChunkUpload',
    chunkUpload: 'chunkUpload',
    chunkProgress: 'chunkProgress',
    chunkSuccess: 'chunkSuccess',
    chunkError: 'chunkError',
    beforeUpload: 'beforeUpload',
    upload: 'upload',
    progress: 'progress,',
    success: 'success',
    error: 'error'
  }
  on (evName, fn) {
    if (!(this.handlersMap[evName] instanceof Array)) {
      this.handlersMap[evName] = []
    }
    this.handlersMap[evName].push(fn)
  }
  trigger (evName, ...args) {
    const handlers = this.handlersMap[evName]
    if (handlers instanceof Array) {
      return handlers.filter(fn => isFn(fn)).map(fn => fn.call(this, ...args))
    }
  }
}

export class UploadOptions {
  url
  name
  data
  headers
  withCredentials
  constructor (url = '', name = 'file', data = {}, headers = {}, withCredentials = false) {
    this.url = url
    this.name = name
    this.data = data
    this.headers = headers
    this.withCredentials = withCredentials
  }
}
export class Chunk {
  queueFile
  index = 0
  blob
  percent = 0
  uploaded = false
  xhr
  uploadEvent = new UploadEvent()
  response = null
  uploading = false
  constructor (blob, index, qf) {
    this.blob = blob
    this.index = index
    this.queueFile = qf
  }
  onProgress (handler) {
    this.uploadEvent.on('progress', handler)
  }
  onSuccess (handler) {
    this.uploadEvent.on('success', handler)
  }
  onError (handler) {
    this.uploadEvent.on('error', handler)
  }
  /**
   * 中断请求
   */
  abort () {
    if (this.xhr) {
      this.xhr.abort()
      // this.percent = 0
    }
  }
  setSuccess (res) {
    console.log(res)
    this.percent = 100
    this.uploaded = true
    this.response = res
    this.uploadEvent.trigger('success', res, this)
  }
  /**
   * 上传
   * @returns {promise}
   */
  upload (opts) {
    return new Promise(async (resolve, reject) => {
      const info = {
        ...this.queueFile,
        chunk: this.blob,
        chunkIndex: this.index
      }
      let data = isFn(opts.data) ? opts.data.call(this, info) : opts.data
      // 判断是否是fn
      // 是则执行fn 得到结果res
      // 如果结果是一个promise 取promise结果;否则直接取res
      if (isPromise(data)) {
        data = await data
      }
      this.uploading = true
      this.xhr = upload({
        ...opts,
        file: this.blob,
        data: data,
        progress: (ev) => {
          this.status = 'uploading'
          this.percent = this.computePercent(ev.total, ev.loaded)
          this.uploadEvent.trigger('progress', ev)
          if (isFn(this.progresshandler)) {
            this.uploadEvent.trigger('progress', ev)
          }
        },
        success: (res) => {
          this.status = 'success'
          this.uploaded = true
          this.percent = 100
          this.response = res
          this.uploading = false
          this.uploadEvent.trigger('success', res, this)
          resolve(res)
        },
        error: (res) => {
          this.status = 'error'
          this.response = res
          this.uploadEvent.trigger('error', res)
          reject(res)
        }
      })
    })
  }
  computePercent (total, loaded) {
    return Math.round(loaded / total * 10000) / 100
  }
}
/** 队列文件 */
export class QueueFile {
  /** 文件对象 */
  file = null
  /** 文件哈希值 */
  fileHash = ''
  /** 压缩后的文件 */
  compressFile = null
  /** 文件的base64数据 */
  fileBase64Data = ''
  /** 压缩后的文件base64数据 */
  compressFileBase64Data = ''
  /** 分块大小 */
  chunkSize = 0
  /** 上传方式 */
  uploadType = UPLOAD_TYPE.serial
  /** 分块数据 */
  chunks = [
    // {
    //   index: 0, // 第几个分块
    //   blob: null, // 分块bob数据
    //   percent: 0, // 上传进度
    //   uploaded: false // 是否已上传
    // }
  ]
  /** 上传百分比 */
  percent = 0
  /** 状态 <string>  pending待处理 ready就绪 progress上传中 success上传成功 error上传失败 */
  status = QF_STATUS.pending
  /** 状态文字 */
  statusText = getQFStatusText(QF_STATUS.pending)
  /** 服务器返回 */
  response = ''
  /** 自定义数据 */
  customData = {}
  /** 上传时参数 */
  UploadOptions = null
  /** 是否获取文件hash值 */
  isHashFile = false
  /** hash方法 */
  hashMethod = null
  uploadEvent = new UploadEvent()
  checkMethod = null
  constructor (opts) {
    for (let o in opts) {
      if (this.hasOwnProperty(o)) {
        this[o] = opts[o]
      }
    }
  }
  /**
   * 初始化分块列表
   */
  initChunks () {
    this.uploadEvent.trigger('beforeChunk', this)
    this.changeStatus(QF_STATUS.chunking)
    const wouldSlice = typeof this.chunkSize === 'number' && this.chunkSize > 0
    // 文件分块
    if (wouldSlice) {
      this.chunks = (sliceFile(this.file, this.chunkSize) || []).map(
        (blob, index) => {
          const chunk = new Chunk(blob, index, this)
          return chunk
        }
      )
    } else {
      //
      this.chunks = [new Chunk(this.file, 0, this.file)]
    }
    this.chunks.forEach(chunk => {
      this.subscribeChunkEvens(chunk)
    })
    this.uploadEvent.trigger('afterChunk', this)
    this.changeStatus(QF_STATUS.chunked)
  }
  /**
   * 订阅分块对象的事件
   * @param {Chunk} chunk
   */
  subscribeChunkEvens (chunk) {
    chunk.onProgress(ev => {
      this.computePercent()
      this.uploadEvent.trigger('progress', ev)
    })
    chunk.onSuccess((...args) => {
      this.computePercent()
      if (this.testIsSuccess()) {
        this.changeStatus(QF_STATUS.success)
      }
      this.uploadEvent.trigger('success', ...args, this)
    })
    chunk.onError(ev => {
      this.changeStatus(QF_STATUS.error)
      this.uploadEvent.trigger('error', ev)
    })
  }
  /**
   * 监听上传进度事件
   * @param {function} fn
   */
  onProgress (fn) {
    this.uploadEvent.on('progress', fn)
  }
  /**
   * 监听成功事件
   * @param {function} fn
   */
  onSuccess (fn) {
    this.uploadEvent.on('success', fn)
  }
  /**
   * 监听失败事件
   * @param {function} fn
   */
  onError (fn) {
    this.uploadEvent.on('error', fn)
  }
  /**
   * 分片之前
   * @param {function} fn
   */
  beforeChunk (fn) {
    this.uploadEvent.on('beforeChunk', fn)
  }
  /**
   * 分片之后
   * @param {function} fn
   */
  afterChunk (fn) {
    this.uploadEvent.on('afterChunk', fn)
  }
  /**
   * hash之前
   * @param {function} fn
   */
  beforeHash (fn) {
    this.uploadEvent.on('beforeHash', fn)
  }
  /**
   * hash之后
   * @param {*} fn
   */
  afterHash (fn) {
    this.uploadEvent.on('afterHash', fn)
  }
  /**
   * 计算百分比进度
   *  @param {*} fn
   */
  computePercent () {
    this.percent = Math.round(this.chunks.map(chunk => chunk.percent).reduce((a, b) => a + b) / this.chunks.length * 100) / 100
  }
  /** 检测是否上传成功 */
  testIsSuccess () {
    return this.chunks.every(chunk => chunk.uploaded && chunk.percent >= 100)
  }
  /**
   * 上传
   */
  async upload () {
    if (!this.chunks.length) {
      this.initChunks()
    }
    if (this.isHashFile) {
      await this.hashFile()
    }
    let uploadedAll = false
    if (typeof this.checkMethod === 'function') {
      uploadedAll = await this.checkUploaded()
    }
    if (uploadedAll) return
    this.changeStatus(QF_STATUS.uploading)
    switch (this.uploadType) {
      case UPLOAD_TYPE.concurrent: // 并行上传
        this.concurrentUpload()
        return Promise.resolve(this)
      case UPLOAD_TYPE.serial: // 串行上传
        return this.serialUpload()
    }
  }
  checkUploaded () {
    return new Promise(resolve => {
      this.changeStatus(QF_STATUS.checking)
      const cb = (statusArr, res) => {
        console.log(statusArr, res)
        let allSuccess = true
        if (statusArr instanceof Array && statusArr.length === this.chunks.length) {
          statusArr.forEach((s, i) => {
            if (s) {
              this.chunks[i].setSuccess(res)
            } else {
              allSuccess = false
            }
          })
        } else {
          allSuccess = false
        }
        this.changeStatus(QF_STATUS.checked)
        resolve(allSuccess)
      }
      this.checkMethod(this, cb)
    })
  }
  /**
   * 改变状态
   * @param {*} status
   */
  changeStatus (status) {
    this.status = status
    this.statusText = getQFStatusText(status)
  }
  /**
   * 并行上传
   * @param {boolean} 是否从开始位置上传
   */
  concurrentUpload (isStart) {
    this.chunks.forEach(chunk => {
      chunk.upload(this.uploadOptions).catch(() => {
        // 有一个分块上传失败，立即中止其他分块的上传
        this.abort()
      })
    })
  }
  /**
   * 串行上传
   * @param {boolean} 是否从开始位置上传
   */
  serialUpload (isStart) {
    return new Promise(resolve => {
      const fn = async index => {
        if (index < this.chunks.length && index >= 0) {
          await this.uploadChunk(index)
          const newIndex = this.chunks.findIndex(ele => !ele.uploaded)
          if (newIndex >= 0) {
            fn(newIndex)
          } else {
            resolve(this.chunks)
          }
        }
      }
      const index = isStart ? 0 : this.chunks.findIndex(ele => !ele.uploaded)
      if (index >= 0) {
        fn(index)
      }
    })
  }
  /**
   *上传指定分块
   *@param {number} index
   */
  uploadChunk (index) {
    return this.chunks[index].upload(this.uploadOptions)
  }
  /**
   * 中止
   */
  abort () {
    this.changeStatus(QF_STATUS.abort)
    this.computePercent()
    this.chunks.filter(ck => ck.uploading).forEach(chk => {
      chk.abort()
    })
  }
  /**
   * 计算文件哈希值
   */
  hashFile () {
    this.uploadEvent.trigger('beforeHash', this)
    this.changeStatus(QF_STATUS.hashing)
    const method = typeof this.hashMethod === 'function' ? this.hashMethod : MD5file
    return method(this.file)
      .then(res => {
        this.fileHash = res
        this.uploadEvent.trigger('afterHash', this)
        this.changeStatus(QF_STATUS.hashed)
        return res
      })
  }
}
export class Uploader {
  /** 上传file Input */
  inputElem = null
  /** 上传队列 */
  queue = []
  /** 分块大小 */
  chunkSize = 0
  /** 分块的上传方式 默认串行上传 */
  uploadType = UPLOAD_TYPE.concurrent
  /** 上传地址 */
  uploadUrl = ''
  /** 是否压缩 */
  compress = false
  /** 压缩配置参数 */
  compressConfig = {
    scale: 1,
    quality: 1
  }
  /** 请求头 */
  headers = {}
  /** 上传时的额外参数，key&value对象或者一个返回key&value对象的函数 如果是函数，函数的参数为 file,chunk,chunkCount,chunkIndex */
  data = {}
  /** 上传的文件字段名 */
  name = 'file'
  /** 支持发送 cookie 凭证信息 */
  withCredentials = false
  /** 已上传的文件列表 */
  fileList = []
  /** 最大个数限制 */
  maxCount = 100
  /** 单个文件大小限制 */
  maxSize = 0
  /** 是否自动上传 */
  autoUpload = false
  /** 触发事件 */
  triggerEvent = 'change'
  /** 上传事件处理 */
  uploadEvent = new UploadEvent()
  // /** 各个钩子函数 */
  // handlers = {
  //   countExceed: [], // 传入参数依次为 totalCount,maxCount, files
  //   sizeExceeded: [], // totalCount, maxCount, files
  //   select: [], // files
  //   beforeRemove: [],
  //   remove: [],
  //   beforeUpload: [],
  //   progress: [],
  //   success: [],
  //   error: []
  // }
  // 是否计算文件hash值
  hashFile = false
  /** 默认算法MD5 */
  hashMethod = null
  /** 检测上传状态的方法 传入参数（file） resolve状态列表 如[0,0,0,1,1,1] */
  checkMethod = null
  constructor (opts) {
    if (isObj(opts)) {
      for (let o in opts) {
        if (this.hasOwnProperty(o)) {
          this[o] = opts[o]
        }
        if (o === 'uploadType') {
          this.setUploadType(opts[o])
        }
      }
    }
    if (isInputElem(this.inputElem)) {
      this.inputElem.addEventListener(this.triggerEvent, async ev => {
        ev = ev || window.event
        const target = ev.target || ev.srcElement
        const files = target.files
        if (files && files.length) {
          const res = this.uploadEvent.trigger('select', files)
          // 有监听且执行结果不全为真时，中止
          if (!await this.canContinueAfterTrigger(res)) return
          // 检查文件数量是否超出
          if (!this.checkCountExceed(files)) return
          // 检查文件大小是否超出
          if (!this.checkSizeExceed(files)) return
          this.initQueue(files)
          if (this.autoUpload) {
            this.upload()
          }
        }
      })
    }
  }
  /**
   * 初始化队列
   * @param {File[]} files 文件对象列表
   */
  initQueue (files) {
    const len = files.length > this.maxCount ? this.maxCount : files.length
    Array.prototype.forEach.call(files, (file, index) => {
      if (index >= len) return false
      const qf = new QueueFile({
        file,
        isHashFile: !!this.hashFile,
        hashMethod: this.hashMethod,
        checkMethod: this.checkMethod,
        uploadType: this.uploadType
      })
      qf.chunkSize = this.chunkSize
      qf.changeStatus(QF_STATUS.reay)
      qf.uploadOptions = new UploadOptions(this.uploadUrl, this.name, this.data, this.headers, this.withCredentials)
      this.subscribeQueueFileEvents(qf)
      this.queue.push(qf)
    })
  }
  /**
   *订阅队列文件的事件
   * @param {QueueFile} qf
   */
  subscribeQueueFileEvents (qf) {
    const trigger = (evName) => (...args) => this.trigger(evName, ...args)
    qf.beforeChunk(trigger('beforeChunk'))
    qf.afterChunk(trigger('afterChunk'))
    qf.beforeHash(trigger('beforeHash'))
    qf.afterHash(trigger('afterHash'))
    qf.onProgress(trigger('progress'))
    qf.onSuccess(trigger('success'))
    qf.onError(trigger('error'))
  }
  testIsFn (fn) {
    if (typeof fn !== 'function') {
      throw new Error(`parameter 1 is not of type 'Function'!`)
    }
    return true
  }
  /**
   * 监听事件
   * @param {string} evName
   * @param {function} action
   */
  on (evName, action) {
    this.uploadEvent.on(evName, action)
  }
  /**
   * 触发事件
   * @param {string} evName
   * @param  {...any} args
   */
  trigger (evName, ...args) {
    return this.uploadEvent.trigger(evName, ...args)
  }
  /**
   * 文件选定时
   * @param {function} fn
   */
  onSelect (fn) {
    this.on('select', fn)
  }
  /**
   * 移除文件之前
   * @param {function} fn
   */
  beforeRemove (fn) {
    this.on('beforeRemove', fn)
  }
  /**
   * 移除文件时
   * @param {function} fn
   */
  onRemove (fn) {
    this.on('remove', fn)
  }
  /**
   * 上传文件之前
   * @param {function} fn
   */
  beforeUpload (fn) {
    this.on('beforeUpload', fn)
  }
  /**
   * 上传成功时
   * @param {function} fn
   */
  onSuccess (fn) {
    this.on('success', fn)
  }
  /**
   * 上传文件失败时
   * @param {function} fn
   */
  onError (fn) {
    this.on('error', fn)
  }
  /**
   * 文件超出数量时
   * @param {function} fn
   */
  onCountExceed (fn) {
    this.on('countExceed', fn)
  }
  /**
   * 文件超出大小时
   * @param {function} fn
   */
  onSizeExceed (fn) {
    this.on('sizeExceed', fn)
  }
  /**
   * 上传文件进度
   * @param {function} fn
   */
  onProgress (fn) {
    this.on('progress', fn)
  }
  /** 分片之前 */
  beforeChunk (fn) {
    this.on('beforeChunk', fn)
  }
  /**
   * 分片之后
   * @param {function} fn
   */
  afterChunk (fn) {
    this.on('afterChunk', fn)
  }
  /**
   * hash之前
   * @param {function} fn
   */
  beforeHash (fn) {
    this.on('beforeHash', fn)
  }
  /**
   *hash之后
   * @param {*} fn
   */
  afterHash (fn) {
    this.on('afterHash', fn)
  }
  /**
   * 触发事件后是否可继续
   * @param {*} res 触发后的返回结果
   */
  async canContinueAfterTrigger (res) {
    if (res instanceof Array) {
      const canContinueList = await Promise.all(res.map(r => {
        const val = isPromise(r) ? r : this.isContinue(r)
        return Promise.resolve(val)
      }))
      if (!canContinueList.every(ele => !!ele)) {
        return false
      }
    }
    return true
  }
  /** 提交 */
  async upload () {
    const beforeUploadRes = this.trigger('beforeUpload', this.queue)
    const canContinue = await this.canContinueAfterTrigger(beforeUploadRes)
    if (!canContinue) return
    switch (this.uploadType) {
      case UPLOAD_TYPE.concurrent:
        this.concurrentUpload()
        break
      case UPLOAD_TYPE.serial:
        this.serialUpload()
        break
    }
  }
  /**
   * 并行上传
   */
  async concurrentUpload () {
    this.queue.forEach(async qf => {
      // 生成hash值
      qf.upload()
    })
  }
  /**
   * 串行上传
   */
  serialUpload () {
    const fn = async index => {
      const qf = this.queue[index]
      await qf.upload()
      const newIndex = index + 1
      if (newIndex < this.queue.length) {
        fn(newIndex)
      }
    }
    fn(0)
  }
  /** 中断上传 */
  abort () {
    this.QueueFile.forEach(qf => {
      qf.abort()
    })
  }
  /**
   * 根据函数返回值判断是否继续执行
   * @param {*} returnVal
   * @returns {Boolean}
   */
  async isContinue (returnVal) {
    const invalidValues = [false, 0, '', null]
    return !invalidValues.some(val => val === returnVal)
  }
  /**
   * 检测文件数量
   * @param {File[]} files 文件列表
   * @returns {Boolean} 是否继续执行
   */
  checkCountExceed (files) {
    const totalCount = files.length + this.queue.length
    if (this.maxCount && files.length && totalCount > this.maxCount) {
      const action = this.handlers.countExceed
      if (action === 'function') {
        return this.isContinue(action.call(this, totalCount, this.maxCount, files))
      }
    }
    return true
  }
  /**
   * 检测文件数量
   * @param {File[]} files 文件列表
   * @returns {Boolean} 是否继续执行
   */
  checkSizeExceed (files) {
    if (!this.maxSize) return true
    const eFiles = files.filter(ele => ele.size > this.maxSize)
    if (eFiles.length) {
      const action = this.handlers.sizeExceeded
      if (action === 'function') {
        return this.isContinue(action.call(this, eFiles, this.maxSize, files))
      }
    }
  }
  /**
   * 删除指定下标的队列文件
   * @param {number} index
   */
  async remove (index) {
    const beforeRemoveRes = this.trigger('beforeRemove', this.queue)
    const canContinue = await this.canContinueAfterTrigger(beforeRemoveRes)
    if (canContinue) {
      this.queue.splice(index, 1)
    }
  }
  /**
   * 设置上传方式
   * @param {*} val
   */
  setUploadType (val) {
    this.uploadType = val === 1 ? UPLOAD_TYPE.concurrent : UPLOAD_TYPE.serial
  }
}
// 最大并发数
// 断线重连次数
