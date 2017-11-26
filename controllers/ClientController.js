const fs = require('fs');
const path = require('path');

const Client = require('../models/Client').Client;
let availableNodes = ['http://localhost:3000'];//, '10.62.0.57:3000'];
let nextNode = 0;


/***********************************************************************************************************************
 * Client API
 **********************************************************************************************************************/

/**
 * GET /remoteFile?filename=<CLIENTS_FILEPATH>
 * Gets the remote url of our file
 * @response {endpoint: the endpoint of the file, _id: _id of remote file}
 */

const getRemoteFileURL = async (req, res) => {
  const { filename } = req.query;
  const { clientId } = req;
  const client = await Client.findOne({_id: clientId});
  if(!client) {
    return res.status(401).send({message: `No files for client ${clientId} on this node.`});
  }

  // TODO: Make this a map for better lookup (Serialize and store in mongo?)
  let endpoint, _id,  matchFound = false;
  for(let i=0; i<client.files.length; i++) {
    const file = client.files[i];
    if(file.clientFileName === filename) {
      matchFound = true;
      _id = file.remoteFileId;
      endpoint = `${file.remoteNodeAddress}/file/${_id}`
    }
  }

  if(!matchFound) return res.status(404).send({message: `No remote match for ${filename}`});

  res.send({endpoint, _id})
};

/**
 * GET /remoteFiles
 * Get all of the remote files a client has
 * @returns [Client's files]
 */
const getRemoteFiles = async (req, res) => {
  const { clientId } = req;
  const client = await Client.findOne({_id: clientId});
  if(!client) {
    return res.status(401).send({message: `Client ${clientId} has no files on this node`});
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
 * body: {clientId, file (as in Client Model}
 * Notify the directory service of a new file belonging to some client
 * @response {message: string}
 */
const notifyNewFile = async (req, res) => {
  const { clientId, file } = req.body;
  let client = await Client.findOne({_id: clientId});
  if(!client) {
    // Create a new client for the client who has just saved a file on a remote node
    client = new Client({_id: clientId})
  }

  client.files.push(file);

  try {
    await client.save();
    res.send({message: `${file.clientFileName} saved for ${clientId}.`})
  } catch (error) {
    console.log(`Error recording of ${clientId}'s new file ${file.clientFileName}`);
    res.status(500).send({message: `Error recording of ${clientId}'s new file ${file.clientFileName}`});
  }

};


/**
 * PUT /notify
 * body: {_id, filename }
 * Notifies the directory service that a file has been updated by a client
 * @response {message: string}
 */
const notifyUpdatedFile = async (req, res) => {
  const { clientId, _id, filename } = req.body;
  try {
    const client = await Client.findOne({_id: clientId});
    if(!client) {
      console.log(`No record of client ${clientId}`);
      res.status(404).send({message: `No record of client ${clientId}`});
    }

    //TODO: Implement clients file's as Map

    // Update the filename (if required)
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
      return res.status(404).send({message: `${clientId} does not have a ${filename}`});
    }

    try {
      await client.save();
      return res.send({message: `${filename} updated for ${clientId}`})
    } catch (err) {
      return res.status(500).send({message: `Error updating ${filename} for ${clientId} `});
    }
  } catch (err) {
    console.log(err);
    res.status(500).send({message: `Error occurred searching for client ${clientId}`});
  }
};


/**
 * DELETE /remoteFile/:clientId/:_id
 * Notifies the directory service that a file has been deleted by a client
 * @response {message: string}
 */
const notifyDeletedRemoteFile = async (req, res) => {
  const { _id, clientId } = req.params;
  try {
    const client = await Client.findOne({_id: clientId});
    if(!client) {
      console.log(`No record of client ${clientId}`);
      res.status(404).send({message: `No record of client ${clientId}`});
    }

    //TODO: Implement clients file's as Map

    let match = false;
    for(let i=0; i<client.files.length; i++) {
      const file = client.files[i];
      if (file.remoteFileId.toString() === _id) {
        client.files.splice(i, 1);
        match = true;
        break;
      }
    }

    if(!match) {
      return res.status(404).send({message: `${clientId} does not have a file ${_id}`});
    }

    try {
      await client.save();
      return res.send({message: `${_id} was deleted for ${clientId}`})
    } catch (err) {
      return res.status(500).send({message: `Error deleting ${_id} for ${clientId} `});
    }
  } catch (err) {
    console.log(err);
    res.status(500).send({message: `Error occurred searching for client ${clientId}`});
  }
};




module.exports = {
  getRemoteFileURL,
  getRemoteFiles,
  getRemoteHost,
  getAllPublicFiles,
  notifyNewFile,
  notifyUpdatedFile,
  notifyDeletedRemoteFile,
};


