/**
 * ArcusNode Service
 *  
 * Copyright 2011 OpenRTMFP
 * 
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 * 
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License received along this program for more
 * details (or else see http://www.gnu.org/licenses/).
 *
 * Author: arcusdev <arcus.node@gmail.com> 
 *
 * This file is a part of ArcusNode.
 */

var util = require('util');
var ArcusNode = require('./lib/arcus_node.js');

//Take command line arguments
var settings = {};
process.argv.forEach(function (val, index, array) {
  if(index < 2)
    return;
  var valArr = val.split('=');
  switch(valArr[0]){
    case 'logLevel':
        settings.logLevel = valArr[1];
        util.print('Setting logLevel to ' + valArr[1] + '\n');
      break;
    case 'logFile':
        settings.logFile = valArr[1];
        util.print('Setting logFile to ' + valArr[1] + '\n');
      break;
    case '-h':
    case '-help':
        util.print(
          '### USAGE ###\n\n' +
          'node service.js [argument1 argument2 ...]\n\n' +
          'Arguments:\n' +
          'logLevel=[level]            [level] can be one of: fatal, error, warn, info, debug' +
          'logFile=[path]              [path] The path to a file to log output to' +
          '\n\n'
        );
        process.exit();
      break;
    default:
      util.print('Argument unknown or malformed: ' + val + '\nStopping process.');
      process.exit();
  }
});

//Startup
util.print(
  'Starting up ArcusNode RTMFP Service.\nCopyright (C) 2011 OpenRTMFP \n' +
  'This program comes with ABSOLUTELY NO WARRANTY.\n' +
  'This is free software, and you are welcome to redistribute it under certain conditions.\n' +
  '(For usage help type "node service.js -h")\n'
);

var arc = new ArcusNode(settings);
arc.run();

process.on('SIGINT', function () {
  util.print('\033[36mArcusNode shutting down...\033[0m\n');
  arc.stop();
});
process.on('exit', function(){
  util.print('\033[36mArcusNode stopped.\033[0m\n');
});

util.print('ArcusNode RTMFP Service running at ' + arc.address.address + ((arc.address.port != '') ? ':' + arc.address.port : '') + '\n');
    