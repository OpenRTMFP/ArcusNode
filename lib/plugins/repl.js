/**
 * REPL Plugin for ArcusNode
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
 * This file is a part of ArcusNode.
 */

var net = require('net')
var repl = require('repl');

/**
 * REPL Plugin for ArcusNode
 *
 * usage:
 * var arc = new ArcusNode();
 * arc.use('repl', 4000);
 *
 * @param {Integer, String} port
 */
module.exports = function(arcus, port){
  if(!port) {
    throw new Error('The repl plugin needs a port or unix socket');
  }
  
  var server = net.createServer(function(socket){
    var ctx = repl.start('Arcus> ', socket).context;
    
    // augment socket to provide some formatting methods
    socket.title = function(str){ this.write('\n  \033[36m' + str + '\033[0m\n'); }
    socket.row = function(key, val){ this.write('  \033[90m' + key + ':\033[0m ' + val + '\n'); }
    socket.writeln = function(str){ this.write(str + '\n'); }
    
    //
    // Commands
    //
    
    /**
     * Stop ArcusNode
     */
    ctx.stop = function(){
      socket.writeln('Stopping ArcusNode...');
      arcus.stop();
      socket.writeln('ArcusNode stopped.');
    }
    
    /**
     * Start ArcusNode
     */
    ctx.start = function(){
      if(arcus.running()){
        socket.writeln('Already running.');
        return;
      }
      socket.writeln('Starting...');
      arcus.run();
      ctx.status();
    }
    
    /**
     * Restart ArcusNode
     */
    ctx.restart = function(){
      socket.writeln('Restarting...');
      arcus.restart();
      ctx.status();
    };
    
    /**
     * The current status of ArcusNode
     */
    ctx.status = function(){
      socket.writeln('Status: ' + arcus.status());
    }
    
  });
  
  server.listen(port);
  
}