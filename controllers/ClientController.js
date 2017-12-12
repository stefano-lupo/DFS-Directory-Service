import fetch from 'node-fetch';
import mongoose from 'mongoose';
const Client = require('../models/Client').Client;

const SECURITY_SERVICE_ENDPOINT = "http://192.168.1.17:3003";

let possibleSlaves = ['http://localhost:3010', 'http://localhost:3011', 'http://localhost:3012'];

// Store slaves in a map (slaveIp -> numberOfAccessesSoFar)
let availableSlaves = new Map();
possibleSlaves.forEach(slave => {
  availableSlaves.set(slave, 0);
});

// Potential for more than one master?
let availableMasters = ['http://localhost:3000'];
let nextMaster = 0;


/***********************************************************************************************************************
 * Client API
 **********************************************************************************************************************/


/**
 * GET /remoteFile/write
 * Gets a host for a client to upload a file to
 * @response {remote: endpoint to upload file to}
 */
export const getMasterServer = async (req, res) => {
  res.send({remote: `${availableMasters[nextMaster]}/file`});
  nextMaster = (++nextMaster) % availableMasters.length;
};


/**
 * GET /remoteFile/read?filename=<CLIENTS_FILEPATH>
 * Gets a remote url of our file for reading
 * @response {endpoint: the endpoint of the file, _id: _id of remote file}
 */

export const getReadRemoteFileURL = async (req, res) => {
  const { filename } = req.query;
  const { clientId } = req;
  console.log(`Looking for: ${filename}`);
  console.log(`Client id : ${clientId}`);

  try {
    const { slaves, remoteFileId } = await getSingleFileInfoByField(clientId, {clientFileName: filename});
    const endpoint = `${getNextSlave(slaves)}/file/${remoteFileId}`;
    res.send({endpoint, _id: remoteFileId})
  } catch (error) {
    res.status(404).send({message: `No remote match for ${filename}`});
  }

};


/**
 * GET /remoteFile/:_id
 * Gets remote file info by _id
 * This reverse lookup (id -> filename etc) is needed (although should be very infrequently) by caching service
 */
export const getRemoteFileInfoById = async (req, res) => {
  const { clientId } = req;
  const { _id } = req.params;

  try {
    const { slaves, clientFileName } = await getSingleFileInfoByField(clientId, {remoteFileId: _id});
    const endpoint = `${getNextSlave(slaves)}/file/${_id}`;
    res.send({endpoint, filename: clientFileName});
  } catch (error) {
    res.status(404).send({message: `Client ${clientId} has no file ${_id}`});
  }
};



/**
 * GET /remoteFiles
 * Get all of client's remote file entries
 * @returns [Client's files]
 */
export const getRemoteFiles = async (req, res) => {
  const { clientId } = req;
  const client = await Client.findOne({_id: clientId});
  if(!client) {
    return res.status(401).send({message: `Client ${clientId} has no files on this node`});
  }

  res.send(client.files);
};




/**
 * GET /publicFiles/:email
 * Gets all of the public files associated with some users email address
 * @response [{remoteFileId, clientFileName}]
 */
export const getPublicFilesByEmail = async (req, res) => {
  const { email } = req.params;

  // Get client id by email from the security service
  const { ok, status, response } = await makeRequest(`${SECURITY_SERVICE_ENDPOINT}/client/${email}`);
  if(!ok) {
    return res.status(status).send(response);
  }

  // Get the client
  const { _id } = response;
  const client = await Client.findOne({_id});
  if(!client) {
    return res.status(404).send
  }

  // Haskel style left to right reduce
  const publicFiles = client.files.reduce((accumulator, { isPrivate, remoteFileId, clientFileName }) => {
    if(!isPrivate){
      accumulator.push({remoteFileId, clientFileName});
    }

    return accumulator;
  }, []);

  res.send({_id: client._id, publicFiles});
};


/**
 * POST /sharedFile
 * Register a new file for this client that points to a file made by someone else
 */
export const registerSharedFile = async (req, res) => {
  const { clientFileName, ownerId, remoteFileId } = req.decrypted;


  try {
    const { slaves } = await getSingleFileInfoByField(ownerId, { remoteFileId });
    console.log(slaves);

    // Create new client if doesn't already exist
    let client = await Client.findOne({_id: req.clientId});
    if(!client) {
      client = new Client({_id: req.clientId});
    }

    // Add owner's file entry with receiving client's file name to receiving clients files
    client.files.push({clientFileName, slaves, remoteFileId});
    await client.save();
    res.send({message: `Added a directory entry for ${req.clientId} for file ${clientFileName}`});

  } catch (error) {
    console.error(error);
    res.status(404).send({message: `Owner ${ownerId} does not have file ${remoteFileId}`});
  }
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
export const notifyNewFile = async (req, res) => {
  const { clientId, file } = req.body;
  let client = await Client.findOne({_id: clientId});

  if(!client) {
    // Create a new client for the client who has just saved a file on a remote node
    client = new Client({_id: clientId})
  }

  // Choose the slaves who will replicate this file
  file.slaves = chooseSlavesToStoreFile();
  client.files.push(file);

  try {
    // Save client and respond to master file system node and tell it which slaves to replicate that file on
    await client.save();
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
export const notifyUpdatedFile = async (req, res) => {
  const { clientId, _id, filename } = req.body;
  try {
    const client = await Client.findOne({_id: clientId});
    if(!client) {
      console.log(`No record of client ${clientId}`);
      res.status(404).send({message: `No record of client ${clientId}`});
    }

    // Update the filename (if required)
    let match = false, slaves = [];
    for(let i=0; i<client.files.length; i++) {
      const file = client.files[i];
      if (file.remoteFileId.toString() === _id) {
        file.clientFileName = filename;
        slaves = file.slaves;
        match = true;
        break;
      }
    }

    if(!match) {
      return res.status(404).send({message: `${clientId} does not have a ${filename}`});
    }

    try {
      await client.save();
      return res.send({message: `${filename} updated for ${clientId}`, slaves})
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
export const notifyDeletedRemoteFile = async (req, res) => {
  const { _id, clientId } = req.params;

  const client = await getSingleFileInfoByField(clientId,  {remoteFileId: _id});

  try {
    const client = await Client.findOne({_id: clientId});
    if(!client) {
      console.log(`No record of client ${clientId}`);
      return res.status(404).send({message: `No record of client ${clientId}`});
    }

    // Remove file from clients files
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






/***********************************************************************************************************************
 * Helper Methods
 **********************************************************************************************************************/

/**
 * Gets the client and the single file we are interested in
 * @param clientId id of client to pull from
 * @param matcher {key: value} of one attribute on a file that the client has
 * @returns client object with a single file that matched
 */
async function getSingleFileInfoByField (clientId, matcher) {
    const key = Object.keys(matcher)[0];
  const value = matcher[key];
  console.log(key + ": " + value);


  const client =  await Client.findOne({_id: mongoose.Types.ObjectId(clientId)},
    {files: { $elemMatch: { [key]: value  }  }
  });

  if(client.files.length === 0) {
    throw new Error(`Could not match file for ${clientId} using ${matcher}`);
  }

  return client.files[0];
}


/**
 * Decides on the next slave that should be used to read from.
 * @param slaves the list of slaves who currently have this file available
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


/**
 * Makes a request to the specified endpoint
 * @param endpoint URL to hit
 * @param method HTTP Verb
 * @param body (optional if POST/PUT)
 * @returns {Promise.<{ok: *, status: *, response: *}>}
 */
async function makeRequest(endpoint, method, body) {
  const headers =  {'Content-Type': 'application/json'};
  let response;
  if(body) {
    response = await fetch(endpoint, {method, body: JSON.stringify(body), headers});
  } else {
    response = await fetch(endpoint, {method, headers})
  }

  const { ok, status } = response;

  const contentType = response.headers.get("content-type");
  if(contentType && contentType.indexOf("application/json") !== -1) {
    response = await response.json();
  }

  return {ok, status, response}
}

