 /**
 * Proxy NetConnection
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

var NetConnection = require('./net_connection.js');

/**
 * Represents a proxy peer connection to ArcusNode
 */
var ProxyNetConnection = module.exports = function(arcus, id, socket, settings){
  this.init(arcus, id, socket, settings);
  this._isProxy = true;
  
  arcus.__p.logger.debug('PNC: Created Peer NetConnection', id);
};

//Inherit from NetConnection 
ProxyNetConnection.prototype.__proto__ = NetConnection.prototype;
