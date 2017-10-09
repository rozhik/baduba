'use strict'

//Requires
var path = require('path');
var resolve = path.resolve;
var debug = require('debug')('baduba:debug');
var error = require('debug')('baduba:errors');
var info = require('debug')('baduba:info');
var dbg = require('debug')('baduba:cur');
var extend = require('extend');
var chokidar = require("chokidar");
var minimatch = require("minimatch");
var yaml = require('js-yaml');
var fs = require('fs-extra');
var Tree = require('./tree');
var nextTick = require('process').nextTick;


//Exports

exports = module.exports = {
    config: configure,
    run: run,
    engine: setEngine,
    on: setCallback
}

//Configuration
var bd = {
    srcFolder: null, //Soure dirrectory root
    dstFolder: null, //Target dir root
    arrow: [], //Arrow of config file with priorities
    engines: {}, //Engines definition name->f( cb, dstFile, srcFile, globalOpts, localOpts )

    isRunning: false, //Is run already called
    scanReady: false, //Does initial dir tree scan cmpleted. 
    chokidarWatcher: null, //Watcher class
    globalOpts: {}, //Global options

    arr: {}, //Parsed arrow
    watchDirs: [], //Dirrectories to watch
    pathHash: {}, // Hash dir->arrow
    srcFiles: {}, // SRC Files arrow->file->stats

    timer: null, //Timer for scheduled tasks
    dst: {}, //Destanation stuff
    tasks: [], //Tasks names queue
    tasksSlots: {'slotA': true, 'slotB': true}, // Avaiable slots
    taskRun: false, //Is any task running

    dircache: {}
}

function configure(srcFolder, dstFolder, arrow) {
    if (!srcFolder || !dstFolder)
        throw Error('configure failed')
    bd.srcFolder = resolve(srcFolder);
    bd.srcPathLen = srcFolder.split('/').length;
    bd.dstFolder = resolve(dstFolder);
    bd.dstPathLen = dstFolder.split('/').length;
    bd.arrow = arrow;
    readArrow()
}
//Running
function run(watching) {
    if (bd.isRunning)
        throw Error('baduba already running');
    if (!bd.srcFolder)
        throw Error('baduba not configured');
    setupScan(watching);
}
function setEngine(name, callback) {
    bd.engines[name] = callback;
}

function makeArrow(arrrowName) {
    var arrowTemplate = {
        folder: false, // Root folder or false if not applied
        filemap: {}, // File map srcFile->dstFile
        opts: {}, // Options for templates etc 
        real: {}, //Real existing files fileName->{path:,stat}
        virtual: {}, //Virtual files fileName->{engine:,opt:}
    }
    return arrowTemplate;
}

function readArrow() {
    var i, k;
    //Loading yaml definition files
    for (i = 0; i < bd.arrow.length; i++) {
        var fn = resolve(bd.srcFolder + '/' + bd.arrow[i] + '.yml');
        //debug('readArrow', fn);
        var doc = makeArrow(bd.arrow[i]);
        var doc2 = yaml.safeLoad(fs.readFileSync(fn, 'utf8'));
        if (!doc2)
            doc2 = {};
        extend(true, doc, doc2);
        bd.arr[ bd.arrow[i] ] = doc;
        if (doc.folder) {
            doc.folder = resolve(doc.folder || bd.srcFolder + '/' + bd.arrow[i]);
            bd.watchDirs.push(doc.folder);
            if (!fs.statSync(doc.folder).isDirectory())
                throw Error('Dir not exists ' + doc.folder)
            bd.pathHash[ doc.folder ] = bd.arrow[i];
        } else {
            //Empty doc folders is allowed
        }
        if (doc.virtual) { //Handling virtual files
            if( !doc.folder ) throw Error('Virtual not allowed without folder for '+bd.arrow[i]);
            for (var vf in doc.virtual) {
                doc.virtual[vf].arrow = bd.arrow[i]; // Set arrow name for virtual
                doc.virtual[vf].templateFile = resolve( doc.folder+'/'+doc.virtual[vf].template )
                var f = findArrow(doc.folder + '/' + vf, bd.pathHash);
                dbg('find '+ doc.folder + '/' + vf,doc.virtual[vf],f)
                invalidate(f, {}) //fdef, stat
            }
        }
        debug('arr', bd.arrow[i], doc)
    }
    //globalOpts
    for (var i = 0; i < bd.arrow.length; i++) {
        extend(true, bd.globalOpts, bd.arr[bd.arrow[i]].opts);
    }
    //bd.watchDirs.push(bd.dstFolder);
    debug(bd.watchDirs)
}

function setupScan(watching) {
    bd.chokidarWatcher = chokidar.watch(bd.watchDirs, {
        persistent: !!watching,
        //persistent: true,
        ignoreInitial: false,
    });
    //bd.chokidarWatcher.on('add', (path, stat) => uni_handler('add', path, stat));
    bd.chokidarWatcher.on('add', (path, stat) => onFileAdd(path, stat));
    bd.chokidarWatcher.on('change', (path, stat) => onFileModify(path, stat));
    bd.chokidarWatcher.on('unlink', (path, stat) => onFileRemove(path, stat));
    bd.chokidarWatcher.on('ready', (a, b) => onReady('zz' + a, b));
}


function onFileAdd(name, stat) {
    var f = findArrow(name, bd.pathHash);
    debug('onFileAdd', name, f);
    if (!f.arrow && bd.scanReady)
        return; //Cleanup dest only for dest at starup 
    var cl = checkMasks(name, f.arrow)
    if (!cl.ok)
        return; //Just ignore file does not match masks
    var arrDef = bd.arr[ f.arrow ];
    arrDef.real[ f.file ] = {
        stat: stat,
        def: f
    }
    invalidate(f, stat);
}

function onFileModify(name, stat) {
    var f = findArrow(name, bd.pathHash);
    debug('onFileModify', name, f);
    if (!f.arrow && bd.scanReady)
        return; //Cleanup dest only for dest at starup 
    var cl = checkMasks(name, f.arrow)
    if (!cl.ok)
        return; //Just ignore file does not match masks
    var arrDef = bd.arr[ f.arrow ];
    arrDef.real[ f.file ] = {
        stat: stat,
        def: f
    }
    invalidate(f, stat);
}

function onFileRemove(name) {
    var f = findArrow(name, bd.pathHash);
    debug('onFileRemove', name, f);
    if (!f.arrow && bd.scanReady)
        return; //Cleanup dest only for dest at starup 
    var cl = checkMasks(name, f.arrow)
    if (!cl.ok)
        return; //Just ignore file does not match masks
    var arrDef = bd.arr[ f.arrow ];
    delete arrDef.real[ f.file ];
    invalidate(f, null);
}


//Reevaluate stuff related to file
function invalidate(fdef, stat) {
    debug('invalidate', fdef.file)
    var isNew = false;
    if (!bd.dst[ fdef.file ]) {
        isNew = true;
        bd.dst[ fdef.file ] = {
            valid: false,
            dep: {}
        };
    }
    bd.dst[ fdef.file ].valid = false;
    if (stat === null) {
        delete bd.dst[ fdef.file ].dep[ fdef.arrow ];
    } else {
        bd.dst[ fdef.file ].dep[ fdef.arrow ] = stat;

    }
    queueTask(fdef.file)

}


function uni_handler(event, name, stat) {
    debug('uni_handler', event, name);
    var f = findArrow(name, bd.pathHash);
    if (!f.arrow && bd.scanReady)
        return; //Cleanup dest only for dest at starup + TODO: delete
}
//
//Util stuff
function copyFile(src, dst) {

}
function checkMasks(file, arrow) {
    //debug('checkMasks',file,arrow)
    var r = {
        ok: true
    }, ad = bd.arr[arrow];
    if (ad.allow_mask) {
        r.ok = false;
        for (var i = 0; !r.ok && i < ad.allow_mask.length; i++) {
            r.ok = minimatch(file, ad.allow_mask[i]);
        }
    }
    if (ad.ignore_mask) {
        for (var i = 0; r.ok && i < ad.ignore_mask.length; i++) {
            r.ok = !minimatch(file, ad.ignore_mask[i]);
        }
    }
    //!TODO: maybe have sence add more patterns
    return r;
}
function findArrow(file, hash) {
    for (var k in hash) {
        //debug(k,' in ',file)
        if (file.indexOf(k) === 0) {
            var file = file.substr(k.length + 1);
            var arrow = hash[k];
            // File mapping
            var mapedFile = bd.arr[arrow].filemap[ file ] || file;

            return {
                arrow: arrow,
                k: k,
                r: file,
                file: mapedFile,
                l: k.length
            };
        }
    }
    return {};
}
//Psevdo event handling
function setCallback(event, callback) {

}

function onReady(a, b) {
    info('ready', a, b, bd.dst)
    info('tasks', bd.tasks)
    bd.scanReady=true;
    nextTick(nextTask);
}

function nextTask() {
    bd.taskRun = true;
    if (!bd.tasks.length) {
        // No tasks todo
        debug('No tasks');
//        bd.timer = setTimeout( nextTask, 1000);
        bd.taskRun = false;
        return;
    }
    runTask(bd.tasks.shift());
}

function runTask(task) {
    if (bd.dst[ task ].valid) {
        //Task is already done
        debug('task DONE', task)
        return nextTick(nextTask);
    }
    debug('task DO', task)
    var td = bd.dst[ task ];
    td.valid = true;
    td.state = 'init';

    var todo = null;
    for (var i = 0; i < bd.arrow.length; i++) {
        var arrow = bd.arrow[i];
        var adef = bd.arr[arrow];
        if (adef.real[ task]) { //If exists real file
            var fDef = bd.arr[ arrow ].real[ task ];
            todo = {
                arrow: arrow,
                engine: 'cp',
                file: fDef.def.k + '/' + fDef.def.r
            }
        }
        if (adef.virtual[ task ]) {
            todo = adef.virtual[ task ]
        }
    }
    if (todo) {
        var tgt = bd.dstFolder + '/' + task;
        if ('function' === typeof bd.engines[todo.engine]) {
            prepareFile(tgt, function () {
                bd.engines[todo.engine](nextTask, tgt, todo.file, bd.globalOpts, todo)
            });
            return;
        } else {
            throw 'Engine ' + todo.engine + ' not defined'
        }
    } else {
        var tgt = bd.dstFolder + '/' + task;
        prepareFile(tgt, nextTask);
        return;
    }
    return nextTick(nextTask);
}

function queueTask(task) {
    debug('Qtask',!!bd.scanReady, !!bd.taskRun,task)
    bd.tasks.push(task);
    if (bd.scanReady && !bd.taskRun) {
        nextTick(nextTask);
    }
}


function prepareFile(target, cb) {
    dbg( 'prepareFile',target)
    info('mkdir', path.dirname(target))
    fs.ensureDir(path.dirname(target),
            function () {
                info('unlink', target)
                fs.unlink(target, cb)
            })
}

