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
var Helper = require('../helper.js');

/**
 * REPL Plugin for ArcusNode
 *
 * usage:
 * var arc = new ArcusNode();
 * arc.use('repl', 4000);
 *
 * TODO:
 * - take settings object from use() arguments
 * - add a simple password authentication and block connections from ip after 3x wrong
 * - add watch() for realtime log view
 * - add stats() for server statistics
 *
 * @param {Integer, String} port
 */
module.exports = function(arcus, port){
  if(!port) {
    throw new Error('The repl plugin needs a port or unix socket');
  }
  
  var _sockets = [];
  var _server = null;
  
  arcus.on('stop', function(){
    _sockets.forEach(function(socket){
      socket.fd && socket.end();
    });
    if (_server.fd) _server.close();
  });
  
  arcus.on('start', function(){
    _server = net.createServer(function(socket){
      _sockets.push(socket);
      
      var ctx = repl.start('Arcus> ', socket).context;
      
      // augment socket to provide some formatting methods
      socket.title = function(str){ this.write('\n  \033[36m' + str + '\033[0m\n'); }
      socket.row = function(key, val){ this.write('  \033[90m' + key + ':\033[0m ' + val + '\n'); }
      socket.writeln = function(str){ this.write(str + '\n'); }
      
      
      //
      // Commands
      //
      
      /**
       * Restart ArcusNode
       */
      ctx.restart = function(){
        socket.writeln('Restarting...');
        setTimeout(function(){
          arcus.restart();
        }, 50);
      };
      
      /**
       * The current status of ArcusNode
       */
      ctx.status = function(){
        socket.writeln('Status: ' + arcus.status());
      }
      
      /**
       * Some stats about arcus node (still to come...)
       */
      ctx.stats = function(){
        socket.title('ArcusNode Stats');
        var mem = process.memoryUsage();
        for(k in mem){
          socket.row(k, mem[k]);
        }
        socket.writeln('');
        var uptime = arcus.uptime();
        socket.row('Arcus uptime', Helper.formatLapsed(uptime[0]));
        socket.row('Process uptime', Helper.formatLapsed(uptime[1]));
        socket.writeln('');
      }
      
    });
    
    _server.listen(port);
  });
  
}