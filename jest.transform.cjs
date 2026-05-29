const ts = require('typescript')

module.exports = {
  process(sourceText, sourcePath) {
    const output = ts.transpileModule(sourceText, {
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2020,
      },
      fileName: sourcePath,
    })

    return { code: output.outputText }
  },
}
