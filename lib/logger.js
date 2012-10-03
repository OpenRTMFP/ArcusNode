// name: logger.js
// version: 0.1.1
// Original: http://github.com/quirkey/node-logger
// Fork: http://github.com/kommander/node-logger
/*

Copyright (c) 2010 Aaron Quint

Permission is hereby granted, free of charge, to any person
obtaining a copy of this software and associated documentation
files (the "Software"), to deal in the Software without
restriction, including without limitation the rights to use,
copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the
Software is furnished to do so, subject to the following
conditions:

The above copyright notice and this permission notice shall be
included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES
OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT
HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,
WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR
OTHER DEALINGS IN THE SOFTWARE.

*/

var path = require('path'),
    util  = require('util'),
    fs   = require('fs');

/**
 * Create a new instance of Logger, logging to the stream at logStream
 * if logStream is a string it is asumed to be a file path
 * if logStream is an object, it is asumed to have a write method which will be used
 * if logStream is null, log to STDOUT.
 */
var Logger = function(logStream, level) {
  this.setLevel((level) ? level : 'debug');
  
  // if a path is given, try to write to it
  if (typeof logStream === 'string') {
    // Write to a file
    logStream = path.normalize(logStream);
    this.stream = fs.createWriteStream(logStream, {flags: 'a', encoding: 'utf8', mode: 0666});
    this.stream.on('error', function(e){
      throw new Error('Log file stream not writeable: ' + util.inspect(logStream));
    });
    
  } else if(logStream != null && typeof logStream == 'object'){
    // Try to use provided object with write method

    // Check for write method
    if(typeof logStream.write !== 'function'){
      throw new Error('Log stream needs write(text) method.');
    }
    
    this.stream = logStream;
    
  } else {
    // default write is STDOUT
    this.stream = {};
    this.stream.write = util.print;
  }

  // Start log
  this.debug("start log");
};

Logger.levels = ['fatal', 'error', 'warn', 'info', 'debug'];

/**
 * The default log formatting function. The default format looks something like:
 * error [Sat Jun 12 2010 01:12:05 GMT-0400 (EDT)] message
 *
 * @param {String} level
 * @param {Date} date
 * @param {String} message
 * @return {String}
 */ 
Logger.prototype.format = function(level, date, message) {
  return [level, ' [', date, '] ', message].join('');
};

/**
 * Set the maximum log level. The default level is "info".
 */
Logger.prototype.setLevel = function(newLevel) {
  var index = Logger.levels.indexOf(newLevel);
  this.levelIndex = (index != -1) ? index : false;
  setupLevels.call(this);
  return this.levelIndex;
};

/**
 * The base logging method. If the first argument is one of the levels, it logs
 * to that level, otherwise, logs to the default level. Can take n arguments
 * and joins them by ' '. If the argument is not a string, it runs util.inspect()
 * to print a string representation of the object.
 */
Logger.prototype.log = function() {
  var args = Array.prototype.slice.call(arguments),
      logIndex = Logger.levels.indexOf(args[0]),
      message = '';

  // if you're just default logging
  if (logIndex === -1) { 
    logIndex = this.levelIndex; 
  } else {
    // the first arguement actually was the log level
    args.shift();
  }
  if (logIndex <= this.levelIndex) {
    // join the arguments into a loggable string
    args.forEach(function(arg) {
      if (typeof arg === 'string') {
        message += ' ' + arg;
      } else {
        message += ' ' + util.inspect(arg, false, null);
      }
    });
    message = this.format(Logger.levels[logIndex], new Date(), message);
    this.stream.write(message + "\n");
    return message;
  }
  return false; 
};

/**
 * Creates prototype methods for used log levels e.g. logger.debug()
 */
var setupLevels = function() {
  for(k in Logger.levels) {
    if(k <= this.levelIndex) {
      Logger.prototype[Logger.levels[k]] = (function(level){
        return function() {
          var args = Array.prototype.slice.call(arguments);
          args.unshift(level);
          return this.log.apply(this, args);
        };
      })(Logger.levels[k]);
    } else {
      Logger.prototype[Logger.levels[k]] = function(){ return false; };
    }
  }
};

//Export
exports.Logger = Logger;
exports.createLogger = function(logFilePath, level) {
  return new Logger(logFilePath, level);
};
