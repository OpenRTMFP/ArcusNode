/**
 * RTMFP Native Protocol Functionality Module for Node
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
 
#include <v8.h>
#include <node.h>
#include <node_buffer.h>
#include <openssl/evp.h>
#include <openssl/aes.h>
#include <string.h>

using namespace v8;  
using namespace node;  

class RTMFP: ObjectWrap
{
  private:
    
  public:
    
    static Persistent<FunctionTemplate> s_ct;
    
    /**
     * Node module initialization and method exposure
     */     
    static void init (Handle<Object> target)
    {
        HandleScope scope;
     
        target->Set(String::New("version"), String::New("0.2"));
        
        Local<FunctionTemplate> t = FunctionTemplate::New(New);

        s_ct = Persistent<FunctionTemplate>::New(t);
        s_ct->InstanceTemplate()->SetInternalFieldCount(1);
        s_ct->SetClassName(String::NewSymbol("RTMFP"));

        NODE_SET_PROTOTYPE_METHOD(s_ct, "decryptBuffer", decryptBuffer);
        NODE_SET_PROTOTYPE_METHOD(s_ct, "encryptBuffer", encryptBuffer);
        NODE_SET_PROTOTYPE_METHOD(s_ct, "finishChecksum", finishChecksum);
        NODE_SET_PROTOTYPE_METHOD(s_ct, "paddingLength", paddingLength);
        NODE_SET_PROTOTYPE_METHOD(s_ct, "readU29", readU29);
        NODE_SET_PROTOTYPE_METHOD(s_ct, "writeU29", writeU29);
        NODE_SET_PROTOTYPE_METHOD(s_ct, "computePeerId", computePeerId);
        
        target->Set(String::NewSymbol("RTMFP"), s_ct->GetFunction());
    }
    
    RTMFP()
    {
    }

    ~RTMFP(){}
    
    /**
     * Creates a new RTMFP instance as a JavaScript Object
     */     
    static Handle<Value> New(const Arguments& args)
    {
      HandleScope scope;
      RTMFP* hw = new RTMFP();
      hw->Wrap(args.This());
      return args.This();
    }
    
    /**
     * Does final packet checksum calculation
     */     
    static Handle<Value> finishChecksum(const Arguments& args) {
      HandleScope scope;
      uint32_t sum = args[0]->Uint32Value();
      sum = (sum >> 16) + (sum & 0xffff);
      sum += (sum >> 16);
      return scope.Close(Integer::New((uint16_t)~sum));
    }
        
    /**
     * Computes the Peer Id of the connected client during handshake,
     * based on the clients signature and public key
     */     
    static Handle<Value> computePeerId(const Arguments& args) {
      HandleScope scope;
      
      Local<Object> sig_key_buf_obj = args[0]->ToObject();
      Local<Object> sig_key_length_obj = args[1]->ToObject();
      
      if (args.Length() < 2 || !Buffer::HasInstance(sig_key_buf_obj)) {
        return ThrowException(Exception::TypeError(String::New("Bad argument")));
      }
      
      char *sig_key_data = Buffer::Data(sig_key_buf_obj);
      
      uint32_t sig_key_length = args[1]->Uint32Value();
      
      char peer_id[32];
      
      EVP_Digest(sig_key_data, sig_key_length, (uint8_t*)&peer_id[0], NULL, EVP_sha256(), NULL);
      
      return scope.Close(Buffer::New(peer_id, 32)->handle_);
    }
    
    /**
     * Writes a U29 encoded integer to a Buffer
     */     
    static Handle<Value> writeU29(const Arguments& args) {
      HandleScope scope;
      
      Local<Object> buf_obj = args[0]->ToObject();
      
      if (args.Length() < 2 || !Buffer::HasInstance(buf_obj)) {
        return ThrowException(Exception::TypeError(String::New("Bad argument")));
      }
      
      char *buf_data = Buffer::Data(buf_obj);
      uint32_t value = args[1]->Uint32Value();
      
      uint32_t pos = args[2]->IsUndefined() ? uint32_t(0) : args[2]->Uint32Value();
      uint32_t startPos = pos;
      
      uint8_t d = value & 0x7F;
      value >>= 7;
      uint8_t c = value & 0x7F;
      value >>= 7;
      uint8_t b = value & 0x7F;
      value >>= 7;
      uint8_t a = value & 0x7F;

      if(a > 0) {
        buf_data[pos++] = 0x80 | a;
        buf_data[pos++] = 0x80 | b;
        buf_data[pos++] = 0x80 | c;
      } else if(b > 0) {
        buf_data[pos++] = 0x80 | b;
        buf_data[pos++] = 0x80 | c;
      } else if(c > 0) {
        buf_data[pos++] = 0x80 | c;
      }
      buf_data[pos++] = d;
     
      return scope.Close(Integer::New(pos - startPos));
    }
    
    /**
     * Reads a U29 encoded integer from a Buffer
     */     
    static Handle<Value> readU29(const Arguments& args) {
      HandleScope scope;
      
      Local<Object> buf_obj = args[0]->ToObject();
      
      if (args.Length() < 1 || !Buffer::HasInstance(buf_obj)) {
        return ThrowException(Exception::TypeError(String::New("Bad argument")));
      }
      
      char *buf_data = Buffer::Data(buf_obj);
      
      uint32_t pos = args[1]->IsUndefined() ? uint32_t(0) : args[1]->Uint32Value();
      
      uint8_t a = 0, b = 0, c = 0, d = 0;
      int8_t s = 0;

      a = buf_data[pos];
      if (a & 0x80) {
        b = buf_data[++pos];
        ++s;
        if (b & 0x80) {
          c = buf_data[++pos];
          ++s;
          if (c & 0x80) {
            d = buf_data[++pos];
            ++s;
          }
        }
      }
      uint32_t value = ((a & 0x7F) << (s * 7));
      --s;
      if (s < 0) {
        return scope.Close(Integer::New(value));
      }
      value += ((b & 0x7F) << (s * 7));
      --s;
      if (s < 0) {
        return scope.Close(Integer::New(value));
      }
      value += ((c & 0x7F) << (s * 7));
      --s;
      if (s < 0) {
        return scope.Close(Integer::New(value));
      }
      
      return scope.Close(Integer::New(value + ((d & 0x7F) << (s * 7))));
    }
    
    /**
     * Decrypts a Buffer with the given key (AES CBC)
     */     
    static Handle<Value> decryptBuffer(const Arguments& args) {
      HandleScope scope;
      
      Local<Object> pkt_obj = args[0]->ToObject();
      Local<Object> key_obj = args[1]->ToObject();
      
      if (args.Length() < 2 || !Buffer::HasInstance(pkt_obj) || !Buffer::HasInstance(key_obj)) {
        return ThrowException(Exception::TypeError(String::New("Bad argument")));
      }
      
      char *pkt_data = Buffer::Data(pkt_obj);
      size_t pkt_length = Buffer::Length(pkt_obj);
      
      char *key_data = Buffer::Data(key_obj);
      
      uint32_t offset = args[2]->IsUndefined() ? uint32_t(0) : args[2]->Uint32Value();
      
      AES_KEY aes_decrypt_key;
      AES_set_decrypt_key((const uint8_t*)key_data, 128, &aes_decrypt_key);
      uint8_t	init_vector[128];
      memset(init_vector, 0, sizeof(init_vector));
      AES_cbc_encrypt((const uint8_t*)&pkt_data[offset], (uint8_t*)&pkt_data[offset], pkt_length - offset, &aes_decrypt_key, init_vector, AES_DECRYPT);
        
      return scope.Close(args[0]);
    }
    
    /**
     * Calculate the padding byte length here due to problems in JS
     */     
    static Handle<Value> paddingLength(const Arguments& args) {
      HandleScope scope;
      
      uint32_t size = args[0]->IsUndefined() ? uint32_t(0) : args[0]->Uint32Value();
      int paddingBytesLength = (0xFFFFFFFF - size + 5) & 0x0F;
    
      return scope.Close(Integer::New(paddingBytesLength));
    }
    
    /**
     * Encrypts a Buffer with the given key (AES CBC)
     */     
    static Handle<Value> encryptBuffer(const Arguments& args) {
      HandleScope scope;
      
      Local<Object> pkt_obj = args[0]->ToObject();
      size_t pkt_length = args[1]->Uint32Value();
      Local<Object> key_obj = args[2]->ToObject();
      
      if (args.Length() < 1 || !Buffer::HasInstance(pkt_obj) || !Buffer::HasInstance(key_obj) || pkt_length <= 0) {
        return ThrowException(Exception::TypeError(String::New("Bad argument")));
      }
      
      char *pkt_data = Buffer::Data(pkt_obj);
      char *key_data = Buffer::Data(key_obj);
      
      uint32_t offset = args[3]->IsUndefined() ? uint32_t(0) : args[3]->Uint32Value();
      
      AES_KEY aes_encrypt_key;
      AES_set_encrypt_key((const uint8_t*)key_data, 128, &aes_encrypt_key);
      uint8_t	init_vector[128];
      memset(init_vector, 0, sizeof(init_vector));
      AES_cbc_encrypt((const uint8_t*)&pkt_data[offset], (uint8_t*)&pkt_data[offset], pkt_length - offset, &aes_encrypt_key, init_vector, AES_ENCRYPT);
      
      return scope.Close(args[0]);
    }
};

Persistent<FunctionTemplate> RTMFP::s_ct;

//Node module exposure
extern "C" {

  static void init (Handle<Object> target) 
  {
    RTMFP::init(target);
  }
  NODE_MODULE(rtmfp, init);
}
