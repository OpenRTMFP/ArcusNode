/**
 * AMF
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

var AMF0 = require('./amf0.js');
var AMF3 = require('./amf3.js');

var AMF0TypesArr = [];
for(k in AMF0.TYPE){
  AMF0TypesArr.push(AMF0.TYPE[k]);
}

/** 
 * Reads AMF0 Values into an array until no AMF type marker is found anymore
 */
exports.readAMF0 = function(pkt) {
  var data = [];
  var value = null;
  while(pkt.available() > 0 && AMF0TypesArr.indexOf(pkt.peek()) != -1) {
    value = AMF0.readValue(pkt);
    if(value != null){
      data.push(value);
    }
  }
  return data;
}