const ts = require('typescript')
module.exports = function loader(source) {
  return ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.React, esModuleInterop: true }, fileName: this.resourcePath }).outputText
}
