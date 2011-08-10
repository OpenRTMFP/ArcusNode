var ArcusNode = require('../lib/arcus_node.js');

//Create a new ArcusNode instance
var arc = new ArcusNode(null);

//Listen to events
arc.on('handshake', function(){
  console.log('EVENT handshake works.');
});

arc.on('connect', function(){
  console.log('EVENT connect works.');
});

arc.on('address', function(){
  console.log('EVENT address works.');
});

arc.on('command', function(){
  console.log('EVENT commands works.');
});

arc.on('disconnect', function(){
  console.log('EVENT disconnect works.');
});

//Use hooks
arc.hook('handshake', function(){
  console.log('HOOK handshake works.');
});

arc.hook('connect', function(){
  console.log('HOOK connect works.');
});

arc.hook('address', function(){
  console.log('HOOK address works.');
});

arc.hook('command', function(){
  console.log('HOOK commands works.');
});

//Add a command and handle it
arc.command('sayWhat', function(){
  console.log('Got command sayWhat: ', Array.prototype.slice.call(arguments, 1));
  return arguments[1].name + ' rocks!';
});

//Start the server
arc.run();