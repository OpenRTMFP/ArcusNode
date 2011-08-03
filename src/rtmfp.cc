/**
 * RTMFP Native Protocol Module for Node
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
#include <openssl/hmac.h>
#include <openssl/dh.h>
#include <openssl/aes.h>
#include <string.h>

using namespace v8;  
using namespace node;  

#define AES_KEY_SIZE 0x20
uint8_t g_dh1024p[] = {
    0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF,
    0xC9, 0x0F, 0xDA, 0xA2, 0x21, 0x68, 0xC2, 0x34,
    0xC4, 0xC6, 0x62, 0x8B, 0x80, 0xDC, 0x1C, 0xD1,
    0x29, 0x02, 0x4E, 0x08, 0x8A, 0x67, 0xCC, 0x74,
    0x02, 0x0B, 0xBE, 0xA6, 0x3B, 0x13, 0x9B, 0x22,
    0x51, 0x4A, 0x08, 0x79, 0x8E, 0x34, 0x04, 0xDD,
    0xEF, 0x95, 0x19, 0xB3, 0xCD, 0x3A, 0x43, 0x1B,
    0x30, 0x2B, 0x0A, 0x6D, 0xF2, 0x5F, 0x14, 0x37,
    0x4F, 0xE1, 0x35, 0x6D, 0x6D, 0x51, 0xC2, 0x45,
    0xE4, 0x85, 0xB5, 0x76, 0x62, 0x5E, 0x7E, 0xC6,
    0xF4, 0x4C, 0x42, 0xE9, 0xA6, 0x37, 0xED, 0x6B,
    0x0B, 0xFF, 0x5C, 0xB6, 0xF4, 0x06, 0xB7, 0xED,
    0xEE, 0x38, 0x6B, 0xFB, 0x5A, 0x89, 0x9F, 0xA5,
    0xAE, 0x9F, 0x24, 0x11, 0x7C, 0x4B, 0x1F, 0xE6,
    0x49, 0x28, 0x66, 0x51, 0xEC, 0xE6, 0x53, 0x81,
    0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF
  };
    
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
     
        target->Set(String::New("version"), String::New("0.1"));
        
        Local<FunctionTemplate> t = FunctionTemplate::New(New);

        s_ct = Persistent<FunctionTemplate>::New(t);
        s_ct->InstanceTemplate()->SetInternalFieldCount(1);
        s_ct->SetClassName(String::NewSymbol("RTMFP"));

        NODE_SET_PROTOTYPE_METHOD(s_ct, "decryptBuffer", decryptBuffer);
        NODE_SET_PROTOTYPE_METHOD(s_ct, "encryptBuffer", encryptBuffer);
        NODE_SET_PROTOTYPE_METHOD(s_ct, "finishChecksum", finishChecksum);
        NODE_SET_PROTOTYPE_METHOD(s_ct, "paddingLength", paddingLength);
        NODE_SET_PROTOTYPE_METHOD(s_ct, "read7BitValue", read7BitValue);
        NODE_SET_PROTOTYPE_METHOD(s_ct, "computePeerId", computePeerId);
        NODE_SET_PROTOTYPE_METHOD(s_ct, "computeAsymetricKeys", computeAsymetricKeys);
        
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
     * Computes the asymetric keys in RTMFP handshake for further communication,
     * based on the public client key and client certificate.
     * Returns an array with three values: [publicServerKey, decryptKey, encryptKey]
     */     
    static Handle<Value> computeAsymetricKeys(const Arguments& args) {
      HandleScope scope;
      
      Local<Object> client_key_obj = args[0]->ToObject();
      Local<Object> client_cert_obj = args[1]->ToObject();
      Local<Object> server_sig_obj = args[2]->ToObject();
      
      if (args.Length() < 3 || !Buffer::HasInstance(client_key_obj) || !Buffer::HasInstance(client_cert_obj) || !Buffer::HasInstance(server_sig_obj)) {
        return ThrowException(Exception::TypeError(String::New("Bad argument")));
      }
      
      char *public_client_key = Buffer::Data(client_key_obj);
      size_t public_client_key_size = Buffer::Length(client_key_obj);
      char *client_certificat = Buffer::Data(client_cert_obj);
      size_t public_client_cert_size = Buffer::Length(client_cert_obj);
      char *server_signature = Buffer::Data(server_sig_obj);
      size_t server_signature_size = Buffer::Length(server_sig_obj);
      
      Local<Array> keys = Array::New();
      
      char public_server_key[128];
      char decrypt_key[128];
      char encrypt_key[128];
      
      /* Diffie Hellman Key exchange */
      DH*	public_dh_key = DH_new();
      public_dh_key->p = BN_new();
      public_dh_key->g = BN_new();

      BN_set_word(public_dh_key->g, 2);
      BN_bin2bn(g_dh1024p, 128, public_dh_key->p);
      DH_generate_key(public_dh_key); 

      //Fill the servers public key
      BN_bn2bin(public_dh_key->pub_key, (uint8_t*)public_server_key);
      
      uint8_t shared_secret[public_client_key_size];
      BIGNUM *bn_public_client_key = BN_bin2bn((const uint8_t*)public_client_key, public_client_key_size, NULL);
      DH_compute_key(shared_secret, bn_public_client_key, public_dh_key);
        
      BN_free(bn_public_client_key);

      DH_free(public_dh_key);
      
      /* Generate asymetric keys */
      int bufSize = server_signature_size + 128;
      uint8_t buf[bufSize];
      memcpy(buf, server_signature, server_signature_size);
      memcpy(&buf[server_signature_size], public_server_key, 128);
      
      uint8_t md1[AES_KEY_SIZE];
      uint8_t md2[AES_KEY_SIZE];

      // doing HMAC-SHA256 of one side
      HMAC(EVP_sha256(), buf, bufSize, (const uint8_t*)client_certificat, public_client_cert_size, md1, NULL);
      // doing HMAC-SHA256 of the other side inverting the packet
      HMAC(EVP_sha256(), (const uint8_t*)client_certificat, public_client_cert_size, buf, bufSize, md2, NULL);
   
      //Finally compute serverside key pair
      HMAC(EVP_sha256(), shared_secret, public_client_key_size, md1, sizeof(md1), (uint8_t*)decrypt_key, NULL);
      HMAC(EVP_sha256(), shared_secret, public_client_key_size, md2, sizeof(md2), (uint8_t*)encrypt_key, NULL);
      
      keys->Set(uint32_t(0), Buffer::New(public_server_key, 128)->handle_);
      keys->Set(uint32_t(1), Buffer::New(decrypt_key, 128)->handle_);
      keys->Set(uint32_t(2), Buffer::New(encrypt_key, 128)->handle_);
      
      return scope.Close(keys);
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
     * Reads a 7-bit encoded integer from a Buffer
     */     
    static Handle<Value> read7BitValue(const Arguments& args) {
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
      
      if (args.Length() < 1 || !Buffer::HasInstance(pkt_obj) || !Buffer::HasInstance(key_obj)) {
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
