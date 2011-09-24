var ArcusNode = require('../lib/arcus_node.js');

//Create a new ArcusNode instance
var arc = new ArcusNode(null);

arc.on('connect', function(nc, options, username, password){
  // Let the connection wait for auth, 
  // if we need to authenticate the connection with data elsewhere
  nc.wait();
  
  var users = {
    foo: 'bar',
    name: 'password'
  }
  
  //Make sure the username and password are given
  if(typeof(username) == 'undefined' || typeof(password) == 'undefined'){
    nc.fail();
    return;
  }
  
  if(users[username] === password){
    nc.accept('Authentication successfull.');
  } else {
    nc.reject('message');
  }
  
});

//Start the server
arc.run();