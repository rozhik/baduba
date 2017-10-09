# baduba
Build tool for conditional composing file tree.

## Methods
 Api

### config( configFolder, destination, configArrow )
 Configure _baduba_.
 * _configFolder_: folder with configuration files
 * _destination_: destination folder
 * _configArrow_: array with configuration files in priority list. Last one have highest priority.

### run( watching )
 Run _baduba_.
 * _watching_: Boolean flag. True - watch mode

### config( engine, callback )
 Setup engine.
 * _engine_: engine name.
 * _callback_: callback

## Configuration files
 Files.

### folder: _optional string_
Relative path for source files.

### ignore_mask: _optional array of string_
 List of ignored file masks. See https://www.npmjs.com/package/minimatch

### allow_mask _optional array of string_
List of allowed filemasks. By default all files is allowed.

### filemap _optional object <filename: sourceFilename>_
Map of source files.

### virtual _optional object_
Virtual files
```YAML
virtual:
    #Virtual destanation file name
    "virtuals/test.js":
        #generator module name
        engine: swig
        template: test.swig
        #generator extra parameters
        opts:
            param: value
    "virtuals/test.json":
        engine: dump
        opts:
            local:val
```
### opts _array_
Options. Object combined from all opts and passed to engines.

### transformer (TODO)
transformer

### delete (TODO)
Deletor




## Ussage sample
Folder __sample/index.js__ contains usage sample.

```javascript
var baduba = require('baduba');
var fs = require('fs-extra');


baduba.config('src', 'dst', ['lowprio', 'middleprio', 'topprio']);
baduba.engine('cp', engineHardlink);
baduba.engine('swig', engineSwig);
baduba.run(true);


function engineCopy(cb, dstFile, srcFile, globalOpts, localOpts) {
    fs.copy(srcFile, dstFile, cb)
}

var swig = require('swig');
swig.setDefaults({
    varControls: ['[[{', '}]]'],
    tagControls: ['[[%', '%]]'],
    cmtControls: ['[[#', '#]]']
});

function engineSwig(cb, dstFile, srcFile, globalOpts, localOpts) {
    var template = swig.compileFile( localOpts.templateFile );
    var output = template({
        global: globalOpts,
        loc: localOpts.opts,
        src: srcFile,
        dst: dstFile
    });
    fs.writeFile( dstFile, output, cb);
}
```

 == Config files
