#!/usr/bin/env node

"use strict"

const baduba = require("../baduba.js");
const fs = require('fs-extra');
const argv = require('minimist')(process.argv.slice(2));
var swig = require('swig');
swig.setDefaults({
    varControls: ['[[{', '}]]'],
    tagControls: ['[[%', '%]]'],
    cmtControls: ['[[#', '#]]']
});


let srcDir = "src";
let dstDir = "dst";
let arrow = [];
let watch = false;

if( argv.w ) watch = true;
if( argv.s ) srcDir = argv.s;
if( argv.d ) dstDir = argv.d;
arrow = argv._;

if( !arrow.length ) {
    console.log(
`
Ussage: baduba-cli [-s <confDir>] [-d <dstDir>] [-w] <config 1> [... <config N>]
    -s confDir: Folder with configuration files
    -d dstDir: Destination folder
    -w: Watch mode
    config files: config file names without extension
`);
}

baduba.config(srcDir, dstDir, arrow);
baduba.engine('copy', engineCopy);
baduba.engine('swig', engineSwig);
baduba.run(watch);

// Engines
function engineCopy(cb, dstFile, srcFile, opt ) {
    fs.copy(srcFile, dstFile, cb)
}


function engineSwig(cb, dstFile, srcFile, opt ) {
    var template = swig.compileFile( srcFile );
    var output = template( opt );
    fs.writeFile( dstFile, output, cb)
}