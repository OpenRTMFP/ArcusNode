/**
 * KeyExchange - Diffie-Hellman Key Exchange Module for Node
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
    
class KeyExchange: ObjectWrap
{
  private:
    
  public:
    
    static Persistent<FunctionTemplate> s_ct;
    DH* dh;

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
        s_ct->SetClassName(String::NewSymbol("KeyExchange"));

        NODE_SET_PROTOTYPE_METHOD(s_ct, "computeAsymetricKeys", computeAsymetricKeys);
        NODE_SET_PROTOTYPE_METHOD(s_ct, "generateKeyPair", generateKeyPair);
        NODE_SET_PROTOTYPE_METHOD(s_ct, "computeSharedSecret", computeSharedSecret);
        
        target->Set(String::NewSymbol("KeyExchange"), s_ct->GetFunction());
    }

    KeyExchange() : ObjectWrap()
    {
      dh = NULL;
    }

    ~KeyExchange(){
      if (dh) DH_free(dh);
    }

    /**
     * Creates a new KeyExchange instance as a JavaScript Object
     */     
    static Handle<Value> New(const Arguments& args)
    {
      HandleScope scope;
      KeyExchange* hw = new KeyExchange();
      hw->Wrap(args.This());
      return args.This();
    }
    
    /**
     * Generates a private/public keypair for dh key exchange
     *
     * @return {Array} [privateKey, publicKey]
     */
    static Handle<Value> generateKeyPair(const Arguments& args) {
      KeyExchange *ke = ObjectWrap::Unwrap<KeyExchange>(args.This());
      HandleScope scope;
      
      char private_key[128];
      char public_key[128];
      
      // Create DH keypair
      ke->dh = DH_new();
      ke->dh->p = BN_new();
      ke->dh->g = BN_new();

      BN_set_word(ke->dh->g, 2);
      BN_bin2bn(g_dh1024p, 128, ke->dh->p);
      DH_generate_key(ke->dh);

      //Fill the servers public key
      BN_bn2bin(ke->dh->pub_key, (uint8_t*)public_key);
      BN_bn2bin(ke->dh->priv_key, (uint8_t*)private_key);

      Local<Array> keys = Array::New();
      
      keys->Set(uint32_t(0), Buffer::New(private_key, 128)->handle_);
      keys->Set(uint32_t(1), Buffer::New(public_key, 128)->handle_);
            
      return scope.Close(keys);
    }
    
    /**
     * Computes the shared secret from a public key
     */
    static Handle<Value> computeSharedSecret(const Arguments& args) {
      KeyExchange *ke = ObjectWrap::Unwrap<KeyExchange>(args.This());
      HandleScope scope;
      
      Local<Object> far_key_obj = args[0]->ToObject();
      
      if (args.Length() < 1 || !Buffer::HasInstance(far_key_obj)) {
        return ThrowException(Exception::TypeError(String::New("Bad argument")));
      }

      if(DH_size(ke->dh) <= 0){
        return ThrowException(Exception::TypeError(String::New("DH empty. Generate Keypair first.")));
      }
      
      char *far_key = Buffer::Data(far_key_obj);
      size_t far_key_size = Buffer::Length(far_key_obj);
      
      char shared_secret[128];
      BIGNUM *bn_far_key = BN_bin2bn((const uint8_t*)far_key, far_key_size, NULL);
      DH_compute_key((unsigned char*)shared_secret, bn_far_key, ke->dh);

      BN_free(bn_far_key);

      return scope.Close(Buffer::New(shared_secret, 128)->handle_);
    }
    
    /**
     * Computes the asymetric keys in RTMFP handshake for further communication.
     * Returns an array with three values: [decryptKey, encryptKey]
     */
    static Handle<Value> computeAsymetricKeys(const Arguments& args) {
      HandleScope scope;
      
      Local<Object> shared_secret_obj = args[0]->ToObject();
      Local<Object> initiator_nonce_obj = args[1]->ToObject();
      Local<Object> responder_nonce_obj = args[2]->ToObject();
      
      if (args.Length() < 3 || !Buffer::HasInstance(shared_secret_obj) || !Buffer::HasInstance(initiator_nonce_obj) || !Buffer::HasInstance(responder_nonce_obj)) {
        return ThrowException(Exception::TypeError(String::New("Bad argument")));
      }
      
      char *shared_secret = Buffer::Data(shared_secret_obj);
      size_t shared_secret_size = Buffer::Length(shared_secret_obj);
      char *initiator_nonce = Buffer::Data(initiator_nonce_obj);
      size_t initiator_nonce_size = Buffer::Length(initiator_nonce_obj);
      char *responder_nonce = Buffer::Data(responder_nonce_obj);
      size_t responder_nonce_size = Buffer::Length(responder_nonce_obj);
      
      uint8_t md1[AES_KEY_SIZE];
      uint8_t md2[AES_KEY_SIZE];

      // doing HMAC-SHA256 of one side
      HMAC(EVP_sha256(), responder_nonce, responder_nonce_size, (const uint8_t*)initiator_nonce, initiator_nonce_size, md1, NULL);
      // doing HMAC-SHA256 of the other side
      HMAC(EVP_sha256(), initiator_nonce, initiator_nonce_size, (const uint8_t*)responder_nonce, responder_nonce_size, md2, NULL);

      char decrypt_key[128];
      char encrypt_key[128];
      
      // now doing HMAC-sha256 of both result with the shared secret DH key
      HMAC(EVP_sha256(), shared_secret, shared_secret_size, md1, AES_KEY_SIZE, (uint8_t*)decrypt_key, NULL);
      HMAC(EVP_sha256(), shared_secret, shared_secret_size, md2, AES_KEY_SIZE, (uint8_t*)encrypt_key, NULL);
            
      Local<Array> keys = Array::New();
      
      keys->Set(uint32_t(0), Buffer::New(decrypt_key, 128)->handle_);
      keys->Set(uint32_t(1), Buffer::New(encrypt_key, 128)->handle_);
      
      return scope.Close(keys);
    }
    
};

Persistent<FunctionTemplate> KeyExchange::s_ct;

//Node module exposure
extern "C" {

  static void init (Handle<Object> target) 
  {
    KeyExchange::init(target);
  }
  NODE_MODULE(keyexchange, init);
}