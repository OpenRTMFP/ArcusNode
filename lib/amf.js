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

//AMF0 Format Types
var AMF0 = {
  'AMF_NUMBER':         0x00,
  'AMF_BOOLEAN':        0x01,
  'AMF_STRING':         0x02,
  'AMF_BEGIN_OBJECT':   0x03,
  'AMF_NULL':           0x05,
  'AMF_UNDEFINED':      0x06,
  'AMF_ECMA_ARRAY':     0x08, 
  'AMF_END_OBJECT':     0x09,
  'AMF_STRICT_ARRAY':   0x0A,
  'AMF_LONG_STRING':    0x0C,
  'AMF_AVMPLUS_OBJECT': 0x11
};
module.exports.AMF0 = AMF0;

var AMF0TypesArr = [];
for(k in AMF0){
  AMF0TypesArr.push(AMF0[k]);
}

/** 
 * Reads AMF0 Values into an array until no AMF type marker is found anymore,
 * or the given length is exceeded
 */
module.exports.read = function(pkt, length) {
  var data = [];
  while(pkt.available() > 0 && AMF0TypesArr.indexOf(pkt.peek()) != -1) {
    data.push(module.exports.readValue(pkt));
  }
  return data;
}

/**
 * Reads an AMF0 value from the current position in the packet
 */
module.exports.readValue = function(pkt){
  switch(pkt.peek()) {
    case AMF0.AMF_NUMBER:
      return module.exports.readNumber(pkt);
      break;
    case AMF0.AMF_BOOLEAN:
      return module.exports.readBool(pkt);
      break;
    case AMF0.AMF_STRING:
      return module.exports.readString(pkt);
      break;
    case AMF0.AMF_BEGIN_OBJECT:
      return module.exports.readObject(pkt);
      break;
    case AMF0.AMF_NULL:
    case AMF0.AMF_UNDEFINED:
      pkt.skip(1);
      return null;
      break;
    default:
      throw new Error('Unhandled AMF0 value: ' + pkt.peek());
  }
};

/**
 * Reads an AMF encoded string from the current position in the packet
 */
module.exports.readString = function(pkt){
  if(pkt.readInt8() != AMF0.AMF_STRING){
    throw new Error('Not an AMF string marker.');
  }
  return pkt.readBytes(pkt.readInt16()).toString('ascii');
};

/**
 * Reads an AMF encoded object from the current position in the packet
 */
module.exports.readObject = function(pkt){
  if(pkt.readInt8() != AMF0.AMF_BEGIN_OBJECT){
    throw new Error('Not an AMF object marker.');
  }
  var object = {};
  while(pkt.peek() != AMF0.AMF_END_OBJECT) {
    var key = pkt.readBytes(pkt.readInt16()).toString('ascii');
    //console.log('amf read key: ', key);
    if(key != '') {
      object[key] = module.exports.readValue(pkt);
    }
  }
  if(pkt.readInt8() != AMF0.AMF_END_OBJECT){
    throw new Error('No AMF object close marker found.');
  }
  return object;
};

/**
 * Reads an AMF encoded boolean value from the current position in the packet 
 */
module.exports.readBool = function(pkt){
  if(pkt.readInt8() != AMF0.AMF_BOOLEAN){
    throw new Error('Not an AMF boolean marker.');
  }
  return (pkt.readInt8() == 0x00) ? true  : false;
};

/**
 * Reads an AMF encoded double value from the current position in the packet
 */
module.exports.readNumber = function(pkt){
  if(pkt.readInt8() != AMF0.AMF_NUMBER){
    throw new Error('Not an AMF number marker.');
  }
  return pkt.readDouble();
};
