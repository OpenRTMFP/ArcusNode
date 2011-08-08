/**
 * AMF3
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
 
//AMF3 Format Types
var AMF3 = {
  'UNDEFINED_MARKER':  0x00,
  'NULL_MARKER':       0x01,
  'FALSE_MARKER':      0x02,
  'TRUE_MARKER':       0x03,
  'INTEGER_MARKER':    0x04,
  'DOUBLE_MARKER':     0x05,
  'STRING_MARKER':     0x06,
  'XML_DOC_MARKER':    0x07, 
  'DATE_MARKER':       0x08, 
  'ARRAY_MARKER':      0x09,
  'OBJECT_MARKER':     0x0A,
  'XML_MARKER':        0x0B,
  'BYTE_ARRAY_MARKER': 0x0C
};
exports.TYPE = AMF3;

/**
 * Reads an AMF3 value from the current position in the packet
 */
exports.readValue = function(pkt){
  switch(pkt.peek()) {
    case AMF3.INTEGER_MARKER:
      return exports.readInteger(pkt);
      break;
    case AMF3.DOUBLE_MARKER:
      return exports.readDouble(pkt);
      break;
    case AMF3.FALSE_MARKER:
      return false;
      break;
    case AMF3.TRUE_MARKER:
      return true;
      break;
    case AMF3.STRING_MARKER:
      return exports.readString(pkt);
      break;
    case AMF3.OBJECT_MARKER:
      return exports.readObject(pkt);
      break;
    case AMF3.NULL_MARKER:
    case AMF3.UNDEFINED_MARKER:
      pkt.skip(1);
      return null;
      break;
    default:
      throw new Error('Unhandled AMF3 value: ' + pkt.peek());
  }
};

/**
 * Reads an AMF3 encoded string from the current position in the packet
 */
exports.readString = function(pkt){
  if(pkt.readInt8() != AMF3.STRING_MARKER){
    throw new Error('Not an AMF3 string marker.');
  }
  return _readString(pkt);  
};

var _readString = function(pkt) {
  var tmp = pkt.readU29();

  if ((tmp & 0x01) == 1) {
    //value
    return pkt.readBytes((tmp >> 1)).toString('utf8');
  } else {
    //reference
    throw new Error("String reference not implemented.");
  }
};

/**
 * Reads an AMF3 encoded integer from the current position in the packet
 */
exports.readInteger = function(pkt){
  throw new Error('Not implemented.');
};

/**
 * Reads an AMF3 encoded double from the current position in the packet
 */
exports.readDouble = function(pkt){
  throw new Error('Not implemented.');
};

/**
 * Reads an AMF3 encoded object from the current position in the packet
 */
exports.readObject = function(pkt){
  if(pkt.readInt8() != AMF3.OBJECT_MARKER){
    throw new Error('Not an AMF3 object marker.');
  }
  
  var object = {}, headU29 = pkt.readU29();
  
  if ((headU29 & 0x01) == 0) {
    //Object reference
    var objectRefIdx = headU29 >> 1;

    throw new Error("Not implemented.");

  } else if ((headU29 & 0x02) == 0) {
    //Traits reference
    var traitsRefIdx = headU29 >> 2;

    throw new Error("Not implemented.");
    
  } else if  ((headU29 & 0x07) == 0x07) {
    //Traits externalizable
    
    throw new Error("Not implemented.");
    
  } else if((headU29 & 0x08) != 0) {
    //Dynamic
    pkt.skip(1);
    
    while(pkt.peek() != AMF3.NULL_MARKER) {
      var key = _readString(pkt);
      if(key != '') {
        object[key] = exports.readValue(pkt);
      }
    }
    if(pkt.readInt8() != AMF3.NULL_MARKER){
      throw new Error('No AMF3 object close marker found.');
    }
    
  } else {
    return null;
  }

  return object;
};