const Client = require('../models/Client').Client;
const hashPassword = require('../models/Client').hashPassword;

const fs = require('fs');
const path = require('path');

let availableNodes = ['http://localhost:3000'];//, '10.62.0.57:3000'];
let nextNode = 0;


/***********************************************************************************************************************
 * Client API
 **********************************************************************************************************************/


/**
 * POST /register
 * body: {email, password, name}
 * Register for an account with the directory service
 * @response {success: boolean, message: string}
 */
const register = async (req, res) => {
  const { email, password, name } = req.body;
  let client = await Client.findOne({ email });

  if(client) {
    console.log(`Account under ${email} already exists!`);
    return res.send({success: true, message: `Account under ${email} already exists!`});
  }

  client = new Client({email, name});
  client.password = hashPassword(password);

  try {
    client.save();
    console.log(`${email} added`);
    res.send({success: true, message: `Account for ${email} successfully created`})
  } catch (error) {
    console.log(error);
    res.status(403).send({success: false, message: error});
  }
};



/**
 * GET /remoteFile/:filename
 * Gets the remote url of our file
 * @response {remote: the endpoint to get the remote file}
 */

// TODO: Implement token stuff for identity / auth
const getRemoteFileURL = async (req, res) => {
  const { filename } = req.params;
  const email = "stefano@test.com";
  const client = await Client.findOne({email});
  if(!client) {
    return res.status(401).send({message: `No user with email address: ${email}`});
  }

  // TODO: Make this a map for better lookup (Serialize and store in mongo?)
  let remote, matchFound = false;
  for(let i=0; i<client.files.length; i++) {
    const file = client.files[i];
    if(file.clientFileName === filename) {
      matchFound = true;
      remote = `${file.remoteNodeAddress}/file/${file.remoteFileId}`
    }
  }

  if(!matchFound) return res.status(404).send({message: `No remote match for ${filename}`});

  res.send({remote})
};

/**
 * GET /remoteFiles/:email
 * Get all of the remote files a client has
 * @returns [Client's files]
 */
const getRemoteFiles = async (req, res) => {
  const { email } = req.params;
  const client = await Client.findOne({email});
  if(!client) {
    return res.status(401).send({message: `No user with email address: ${email}`});
  }

  res.send(client.files);
};


/**
 * GET remoteHost
 * Gets a host for a client to upload a file to
 * @response {remote: endpoint to upload file to}
 */
const getRemoteHost = async (req, res) => {
  res.send({remote: `${availableNodes[nextNode]}`});
  nextNode = (++nextNode) % availableNodes.length;
};

/**
 * GET /publicFiles
 * Gets all of the available public files on this node
 * @response [public files]
 */
const getAllPublicFiles = async (req, res) => {
  let publicFiles = [];
  const clients = await Client.find({});
  clients.forEach(client => {
    publicFiles.push(client.files.filter(file => !file.private));
  });

  res.send(publicFiles)
};




/***********************************************************************************************************************
 * Inter Service API
 **********************************************************************************************************************/

/**
 * POST /notify
 * body: {email, file (as in Client Model}
 * Notify the directory service of a new file belonging to some client
 * @response {message: string}
 */
const notifyNewFile = async (req, res) => {
  const { email, file } = req.body;
  const client = await Client.findOne({email});
  if(!client) {
    console.log("Error: unknown client created a file on remote server!");
    res.status(404).send({message: `Error: Unknown Client ${email}`});
    return;
  }

  client.files.push(file);

  try {
    await client.save();
    res.send({message: `${file.clientFileName} saved for ${email}.`})
  } catch (error) {
    console.log(`Error updating ${email}'s files`);
    res.status(500).send({message: `Error saving ${email}'s new file ${file.clientFileName}`});
  }

};


/**
 * PUT /notify
 * body: {email, _id, filename }
 * Notifies the directory service that a file has been updated by a client
 * @response {message: string}
 */
const notifyUpdatedFile = async (req, res) => {
  const { email, _id, filename } = req.body;
  try {
    const client = await Client.findOne({email});
    if(!client) {
      console.log(`No client file match for ${email} - ${_id}`);
      res.status(404).send({message: `No client file match for ${email} - ${_id}`});
    }

    //TODO: Implement clients file's as Map
    let match = false;
    for(let i=0; i<client.files.length; i++) {
      const file = client.files[i];
      if (file.remoteFileId.toString() === _id) {
        file.clientFileName = filename;
        match = true;
        break;
      }
    }

    if(!match) {
      return res.status(404).send({message: `${email} does not have ${_id}`});
    }

    try {
      await client.save();
      return res.send({message: `${filename} updated for ${email}`})
    } catch (err) {
      return res.status(500).send({message: `Error updating ${filename} for ${email} `});
    }
  } catch (err) {
    console.log(err);
    res.status(500).send({message: `Error occurred searching for client ${email}`});
  }
};

module.exports = {
  register,
  getRemoteFileURL,
  getRemoteFiles,
  getRemoteHost,
  getAllPublicFiles,
  notifyNewFile,
  notifyUpdatedFile
};


