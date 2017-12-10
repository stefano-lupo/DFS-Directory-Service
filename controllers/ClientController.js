const fs = require('fs');
const path = require('path');

const Client = require('../models/Client').Client;
let possibleSlaves = ['http://localhost:3010', 'http://localhost:3011', 'http://localhost:3012'];
let availableSlaves = new Map();
possibleSlaves.forEach(slave => {
  availableSlaves.set(slave, 0);
});
let availableMasters = ['http://localhost:3000'];
let nextMaster = 0;


/***********************************************************************************************************************
 * Client API
 **********************************************************************************************************************/

/**
 * GET /remoteFile/read?filename=<CLIENTS_FILEPATH>
 * Gets the remote url of our file for reading
 * @response {endpoint: the endpoint of the file, _id: _id of remote file}
 */

const getReadRemoteFileURL = async (req, res) => {
  const { filename } = req.query;
  console.log(`Looking for: ${filename}`);
  const { clientId } = req;
  console.log(`Client id : ${clientId}`);
  const client = await Client.findOne({_id: clientId});
  if(!client) {
    return res.status(401).send({message: `No files for client ${clientId} on this node.`});
  }

  // TODO: Make this a map for better lookup (Serialize and store in mongo?)
  let _id;
  for(let i=0; i<client.files.length; i++) {
    const file = client.files[i];
    if(file.clientFileName === filename) {
      _id = file.remoteFileId;
      const endpoint = `${getNextSlave(file.slaves)}/file/${_id}`;
      console.log(`Next endpoint: ${endpoint}`);
      return res.send({endpoint, _id})
    }
  }

  res.status(404).send({message: `No remote match for ${filename}`});

};


/**
 * GET /remoteFile/:_id
 * Gets remote file info by _id
 * This reverse lookup is needed (although should be very infrequently) by caching service
 */
const getRemoteFileInfoById = async (req, res) => {
  const { clientId } = req;
  const { _id } = req.params;

  const client = await Client.findOne({_id: clientId});

  for(let i=0; i<client.files.length; i++) {
    const file = client.files[i];
    if(file.remoteFileId.toString() === _id) {
      const endpoint = `${getNextSlave(file.slaves)}/file/${_id}`;
      const filename = file.clientFileName;
      return res.send({endpoint, filename});
    }
  }

  res.status(404).send({message: `Client ${clientId} has no file ${_id}`});
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
 * GET /remoteFile/write
 * Gets a host for a client to upload a file to
 * @response {remote: endpoint to upload file to}
 */
const getMasterServer = async (req, res) => {
  res.send({remote: `${availableMasters[nextMaster]}/file`});
  nextMaster = (++nextMaster) % availableMasters.length;
};

/**
 * GET /publicFiles
 * Gets all of the available public files that we know about
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


/**
 * POST /sharedFile
 * Register a new file for this client that points to a file made by someone else
 */
const registerSharedFile = async (req, res) => {
  const { clientFileName, slaves, remoteFileId } = req.decrypted;
  console.log(req.clientId);
  let client = await Client.findOne({_id: req.clientId});

  if(!client) {
    client = new Client({_id: req.clientId});
  }

  client.files.push({clientFileName, slaves, remoteFileId});
  await client.save();
  res.send({message: `Added a directory entry for ${req.clientId} for file ${clientFileName}`});
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

  file.slaves = chooseSlavesToStoreFile();

  client.files.push(file);

  try {
    await client.save();

    // Respond to master file system node and tell it which slaves to replicate that file on
    console.log(file.slaves);
    res.send({message: `${file.clientFileName} saved for ${clientId} - Now distribute that file to slaves`, slaves: file.slaves})
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
      return res.status(404).send({message: `No record of client ${clientId}`});
    }

    //TODO: Implement clients file's as Map

    let match = false, slaves;
    for(let i=0; i<client.files.length; i++) {
      const file = client.files[i];
      if (file.remoteFileId.toString() === _id) {
        slaves = file.slaves;
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
      return res.send({message: `${_id} was deleted for ${clientId}`, slaves});
    } catch (err) {
      console.error(err);
      return res.status(500).send({message: `Error deleting ${_id} for ${clientId} `});
    }
  } catch (err) {
    console.log(err);
    res.status(500).send({message: `Error occurred searching for client ${clientId}`});
  }
};

/**
 * Decides on the next slave that should be used to read from.
 * @param slaves the slaves who currently have this file available
 * @returns ip of chosen slave to read from
 */
function getNextSlave(slaves) {

  console.log(`Picking slave from ${slaves}`);
  let nextSlave;
  let lowestAccesses = null;
  slaves.forEach(slave => {
    const slaveAccesses = availableSlaves.get(slave);
    if(lowestAccesses === null || slaveAccesses < lowestAccesses) {
      lowestAccesses = slaveAccesses;
      nextSlave = slave;
      console.log(`${nextSlave} new fewest accesses ${lowestAccesses}`);
    }
  });

  availableSlaves.set(nextSlave, (++lowestAccesses));

  return nextSlave;
}


/**
 * This could be smart about how many of the slaves should store this file
 * For not, just have them all replicate it
 */
function chooseSlavesToStoreFile() {
  return [...availableSlaves.keys()]
}

module.exports = {
  getReadRemoteFileURL,
  getRemoteFileInfoById,
  getRemoteFiles,
  getMasterServer,
  getAllPublicFiles,
  registerSharedFile,
  notifyNewFile,
  notifyUpdatedFile,
  notifyDeletedRemoteFile,
};


