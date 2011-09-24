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
    //If not, let the connection fail -> NetConnection.Connect.Failed
    nc.fail();
    return;
  }
  
  //Check the credentials
  if(users[username] === password){
    //Accept the connection if credentials are correct -> NetConnection.Connect.Success
    //The specified argument is a description which can be accessed in the client at NetStatusEvent|info.description
    nc.accept('Authentication successfull.');
  } else {
    //Reject the connection with the given message -> NetConnection.Connect.Rejected 
    nc.reject('Wrong credentials');
  }
  
});

//Start the server
arc.run();