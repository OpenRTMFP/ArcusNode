# ArcusNode
#### A RTMFP Rendevouz Server For Peer Assisted Networking With Adobe Flash on nodejs

Author: arcusdev [arcus.node@gmail.com]
License: [GPL](http://www.gnu.org/licenses/) 

## Description
ArcusNode is an offspring of [Cumulus](http://github.com/OpenRTMFP/Cumulus), a standalone C++ implementation of the _RTMFP Protocol_ and much more. ArcusNode aims to assist P2P networking with ease of extendability due to Javascript glue with nodejs.

## Build & Installation
To use ArcusNode as a service, get it from [github](http://github.com/OpenRTMFP/ArcusNode) and run:
<pre>
$> git submodule init
$> git submodule update
$> node-waf configure build
$> node service.js
</pre>
You then should see something like:
<pre>
Starting up ArcusNode RTMFP Service.
Copyright (C) 2011 OpenRTMFP
This program comes with ABSOLUTELY NO WARRANTY.
This is free software, and you are welcome to redistribute it under certain conditions.
(For usage help type "node service.js -h")
ArcusNode RTMFP Service running at port 1935
</pre>
1935 is the default port for RTMFP communication.

#### Cygwin
If you run intro problems building node on Cygwin, checkout _https://github.com/joyent/node/wiki/Building-node.js-on-Cygwin-(Windows)_.
If you consider using rebase, use both _./rebaseall_ and _./perlrebase_.

## Usage
### Basic
As you can see in the service.js, it is very easy to use ArcusNode in your own project.
<pre>
var ArcusNode = require('./lib/arcus_node.js');
var arcusService = new ArcusNode();
arcusService.run();
</pre>
ArcusNode already takes a settings object in the constructor, through which later on many customization will be possible.

### Events

At this moment, ArcusNode fires the following (async) events:

* HANDSHAKE
* CONNECT
* DISCONNECT
* COMMAND

ArcusNode provides two methods to add event listeners, <pre>on(type, listener [, context])</pre> and <pre>addListener(type, listener [, context])</pre>,
which both behave the same. The optional _context_ will be used to call the _listener_ in, if not given the _listener_ is called in _ArcusNode context_.
All listeners get passed one argument, an _ArcusEvent_ object. 
The _ArcusEvent_ object provides the following attributes and methods:

* type() - Returns a string with the type of the Event (connect, command, ...)
* arcus() - Returns the ArcusNode instance that dispatched the event
* nc() - If given, returns the NetConnection related to the event, otherwise _undefined_
* request() - If given, return the request object related to the event, otherwise _undefined_
* time() - The timestamp of the event creation
* command - A String with the name of the remote procedure that was called in a COMMAND event
* data - An _Object_ or an _Array_ with event related data (AMF data from a command as Array)
* finish(data) - If the listener is done doing its thing, this must be called to finish the event

Example for a connect event listener with user authentication:
<pre>
var ArcusNode = require('./lib/arcus_node.js');
var ArcusEvent = require('./lib/events.js');
var arcusService = new ArcusNode({ auth: true });

arcusService.on(ArcusEvent.CONNECT, function(evt){
  //If a NetConnection.connect() from the client provided additional arguments, they will be in evt.data Array from index 1
  //NetConnection.connect(ARCUSNODE_URL, 'username', 'password'); -> evt.data[1] == 'username' && evt.data[2] == 'password'
  if(checkAuth(evt.data[1], evt.data[2])) {
    evt.nc().authenticated(true);
  }
  evt.finish();
});

arcusService.run();
</pre>

#### ArcusEvent.finish()
The _finish_ method resumes protocol communication after a listener is done.
The CONNECT event for example is triggered when a connection request is coming in. Then the request is acknowledged to the client immediately,
but the answer for the request is only sent, after the _finish_ method was called by the listener. The _finish_ method can only be called once for an Event.
If there is more than one listener for an event, the user is responsible for calling _finish_ only once.

The arguments the _finish()_ method takes depends on the event type:

**COMMAND**
In the case of a command event, the _finish_ method needs at least one argument,
otherwise the client will get an error result. An error result can be returned explicitly by giving the _finish_ method a boolean _false_ as first argument.
In the case of explicit failure, a second argument can be a string description of the error, which will be sent to the client in the _Responder_ status object.
If _finish_ gets anything else, it is sent to the client as Responder result object.

Example Client side:
<pre>
var responder:Responder = new Responder(function(response) {
  trace(response.what); //-> 'ArcusNode rocks!'
});
connection.call('sayWhat', responder, { name: 'ArcusNode' });
</pre>

Example Server side:
<pre>
arcusService.on(ArcusEvent.COMMAND, function(evt){
  if(evt.command == 'sayWhat') {
    evt.finish({ what: evt.data[0].name + ' rocks!' });
    return;
  }
  evt.finish();
});
</pre>

**CONNECT & DISCONNECT**
These two events do not react on any argument given to _finish_.

**HANDSHAKE**
Can be stopped by explicitly giving _finish_ a boolean _false_.

### ArcusNode Settings

The ArcusNode constructor takes a settings object with the following attributes:

<pre>
.auth 
  Type: Boolean 
  Default: false 
  If set to true, only authenticated NetConnections are allowed, others get disconnected.
  
.port
  Type: Integer
  Default: 1935
  The port that ArcusNode will listen for UDP connections.
  
.address
  Type: String
  Default: ''
  ArcusNode can be run on a specific interface if wanted.
  
.logLevel
  Type: String
  Default: 'warn'
  Can be one of ['fatal', 'error', 'warn', 'info', 'debug'].
  
logFile:
  Type: String, path
  Default: ''
  If a path for a log file is specified, all logging will be written to that file.

.manageInterval 
  Type: Integer, seconds 
  default: 60 
  The interval for the management cycle to do cleanup

.connectionTimeout 
  Type: Integer, milliseconds 
  Default: 120000 
  The timeout for a NetConnection. The connections is dropped after the NetConnection was unused for that amount of time. 

.groupTimeout
  Type: Integer, milliseconds
  Default: 360000
  The timeout for a NetGroup. The group is dropped afer there was no interaction for that amount of time.

.P2SKeepalive
  Type: Integer, milliseconds
  Default: 60000
  The timeout before the server sends a keepalive command to the client.
  Should be less then connectionTimeout.

.maxP2SKeepalive
  Type: Integer
  Default: 3
  How often to max keepalive the connection before dropping it.
</pre>

## Roadmap
To reach version 0.1:

* Add command line arguments
* Stabilize the rendezvouz part
* _Implement management cycle (done)_
* _Add user authentication through a callback method (done)_
* _Add support for RPCs which can be extended easily with javascript functions (done)_
* Add testing scripts and a Flash testing project
* Add AMF0/AMF3 reading and writing (!)

## Development
If you have ideas, suggestions, bugfixes or just want to yell a little at the author,
feel free to contact arcus.node@gmail.com


&copy; Copyright 2011 OpenRTMFP
