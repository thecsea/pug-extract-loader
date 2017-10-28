"use strict";
const loaderUtils = require('loader-utils')
const path = require('path')
const vm = require('vm')
const requireResolve = require('require-resolve')
const _ = require('lodash')

const MAX_RETRY = 5
const MAX_DEPTH = 30

class Execution{
  constructor(code, filename, level) {
    this.script = this._newScript(code, filename)
    this.filename = filename
    this.level = level
    this.dependencies = {}
    this._promises = []
    this._errors = false
    this._toSolve = 0
    this._solved = 0
  }

  _newScript(code, filename){
    return new vm.Script(code, {
      filename: filename,
      displayErrors: true,
    })
  }

  _onComplete(){
    this._solved++
    if(this._solved>=this._toSolve) this._errors = false
  }

  set promises(promise){
    this._toSolve++
    this._errors = true
    this._promises.push(promise.then((res)=>this._onComplete(res)))
  }

  get promises(){
    return Promise.all(this._promises)
  }

  set errors(status){
    this._errors = status
  }

  get errors(){
    return this._errors
  }
}

class Executor{
  constructor(webpackContext) {
    this._webpackContext = webpackContext
    this.sharedData = {}
    this._childs = []
  }

  get promises(){
    return Promise.all(_(this._childs).map(children=>children.promises).value())
  }

  get errors(){
    return _(this._childs).filter(children=>children.errors).size()>0
  }

  _getSandbox(execution){
    return {
      require: resourcePath => {
        //keep "in" search to match "undefined"
        if (resourcePath in execution.dependencies) return execution.dependencies[resourcePath]
        let prom = this._loadResource(resourcePath, execution.filename, execution.level)
          .then(data => execution.dependencies[data.key] = data.value)
        execution.promises = prom
        execution.errors = true
      },
      module: {},
      exports: {},
      sharedData: {},
      get pug(){
        return require('pug-runtime')
      }
    }
  }

  _newContext(execution){
    let sandbox = this._getSandbox(execution)
    sandbox.sharedData = this.sharedData || {}
    let context = vm.createContext(sandbox)
    return {context: context, sandbox: sandbox, execute:()=>execution.script.runInContext(context)}
  }

  async _waitPromises(execution){
    await execution.promises
    if(execution.level == 0) await this.promises
  }

  _singleExecution(execution){
    execution.errors = false
    let context = this._newContext(execution)
    try{
      context.execute()
    }catch(e){
      execution.errors = true
      throw e
    }
    return context
  }

  _continueLoop(execution){
    if(execution.level == 0) return this.errors
    return execution.errors
  }

  async execute(code, filename, level){
    filename = filename || this._webpackContext.resourcePath
    level = level || 0
    if(level>MAX_DEPTH) return Promise.reject('Max depth reached: '+level)
    let execution = new Execution(code, filename, level)
    this._childs.push(execution)

    let context
    let counter = 0
    do {
      let lastError = ''
      await this._waitPromises(execution) //retrieve errors are not caught
      try{
        context = this._singleExecution(execution)
      }catch(e){
        lastError = e
      }
      if(counter++>MAX_RETRY) return Promise.reject('Max retry reached: '+lastError)
    }while(this._continueLoop(execution))

    return context.sandbox.module.exports || context.sandbox.exports
  }

  async _loadResource(resource, filename, level){
    let fullPath = (requireResolve(resource.replace(/!/gi, ''), filename) || {}).src
    if(fullPath.match(/node_modules/gi)) return {key: resource, value: require(fullPath)}
    let loaded = await this._loadModule(fullPath)
    let executed = await this.execute(loaded, fullPath, level+1)
    return {key: resource, value: executed}
  }

  async _loadModule(request) {
    return new Promise((resolve, reject) => {
      // LoaderContext.loadModule automatically calls LoaderContext.addDependency for all requested modules
      this._webpackContext.loadModule(
        request,
        (err, src) => (err ? reject(err) : resolve(src))
      );
    });
  }
}

module.exports = function(source) {
  this.cacheable && this.cacheable()
  let options = loaderUtils.getOptions(this) || {}
  let locals = options.locals || {}
  locals  = _(locals).cloneDeep()
  let callback = this.async()

  let executor = new Executor(this)
  const htmlGenerator = "module.exports = (function(){return sharedData.template(sharedData.locals);})()";
  executor.execute(source)
    .then(res=>{
      executor.sharedData.template = res
      executor.sharedData.locals = locals
      return executor.execute(htmlGenerator)
    })
    .then(res => callback(null, res))
    .catch(err=>callback(err instanceof Error ? err : new Error(err)))

};