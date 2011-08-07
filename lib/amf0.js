/**
 * AMF0
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
 
var AMF3 = require('./amf3.js');
 
//AMF0 Format Types
var AMF0 = {
  'NUMBER_MARKER':         0x00,
  'BOOLEAN_MARKER':        0x01,
  'STRING_MARKER':         0x02,
  'BEGIN_OBJECT_MARKER':   0x03,
  'NULL_MARKER':           0x05,
  'UNDEFINED_MARKER':      0x06,
  'ECMA_ARRAY_MARKER':     0x08, 
  'END_OBJECT_MARKER':     0x09,
  'STRICT_ARRAY_MARKER':   0x0A,
  'LONG_STRING_MARKER':    0x0C,
  'AVMPLUS_OBJECT_MARKER': 0x11
};
exports.TYPE = AMF0;

/**
 * Reads an AMF0 value from the current position in the packet
 */
exports.readValue = function(pkt){
  switch(pkt.peek()) {
    case AMF0.NUMBER_MARKER:
      return exports.readNumber(pkt);
      break;
    case AMF0.BOOLEAN_MARKER:
      return exports.readBool(pkt);
      break;
    case AMF0.STRING_MARKER:
      return exports.readString(pkt);
      break;
    case AMF0.BEGIN_OBJECT_MARKER:
      return exports.readObject(pkt);
      break;
    case AMF0.NULL_MARKER:
    case AMF0.UNDEFINED_MARKER:
      pkt.skip(1);
      return null;
      break;
    case AMF0.AVMPLUS_OBJECT_MARKER:
      pkt.skip(1);
      return AMF3.readValue(pkt);
      break;
    default:
      throw new Error('Unhandled AMF0 value: ' + pkt.peek());
  }
};

/**
 * Reads an AMF0 encoded string from the current position in the packet
 */
exports.readString = function(pkt){
  if(pkt.readInt8() != AMF0.STRING_MARKER){
    throw new Error('Not an AMF0 string marker.');
  }
  return pkt.readBytes(pkt.readInt16()).toString('ascii');
};

/**
 * Reads an AMF0 encoded object from the current position in the packet
 */
exports.readObject = function(pkt){
  if(pkt.readInt8() != AMF0.BEGIN_OBJECT_MARKER){
    throw new Error('Not an AMF0 object marker.');
  }
  var object = {};
  while(pkt.peek() != AMF0.END_OBJECT_MARKER) {
    var key = pkt.readBytes(pkt.readInt16()).toString('ascii');
    if(key != '') {
      object[key] = exports.readValue(pkt);
    }
  }
  if(pkt.readInt8() != AMF0.END_OBJECT_MARKER){
    throw new Error('No AMF0 object close marker found.');
  }
  return object;
};

/**
 * Reads an AMF0 encoded boolean value from the current position in the packet 
 */
exports.readBool = function(pkt){
  if(pkt.readInt8() != AMF0.BOOLEAN_MARKER){
    throw new Error('Not an AMF0 boolean marker.');
  }
  return (pkt.readInt8() == 0x00) ? true  : false;
};

/**
 * Reads an AMF0 encoded double value from the current position in the packet
 */
exports.readNumber = function(pkt){
  if(pkt.readInt8() != AMF0.NUMBER_MARKER){
    throw new Error('Not an AMF0 number marker.');
  }
  return pkt.readDouble();
};