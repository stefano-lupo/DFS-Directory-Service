# Distributed File System: Directory Service
This repo contains the code for the directory service for my distributed file system. Links to all components of my file system can be found in the repo for the [test client and client library](https://github.com/stefano-lupo/DFS-Client)

## The Directory Service
The directory service is responsible for keeping track of what files client's have stored and where they are stored. This implementation of the directory service allows each of a client's files to be stored on any subset of the file system nodes - that is, client1's file 1 may be on FS Nodes 1, 2, 3, while client1's file 2 may be on FS Nodes 3, 4, 5. This is a benefit as it causes no restriction on where a client's files must be, allowing the file system nodes to be balanced appropriately.

The Directory Sevice contains a collection of Clients (held in a mongo database). Each client has their `_id` which is created by the security service along with an array of files they have stored on the remote servers. This array of file objects contains the meta data about each file consisting of:
- `clientFileName`: the name of the file on the client's machine
- `isPrivate`: a boolean flag indicating whether or not this file is shared.
- `slaves`: an array of file system slave nodes who have a copy of this file
- `remoteFileId`: the `_id` of the file that it is stored by on the remote file system nodes.

Thus by knowing a client's _id (which is extracted from the authentication token) and a filename (which the client obviously knows), the directory service can lookup the slaves which have a copy of this file and can direct the client to the approrpiate endpoint in order to manipulate it. The directory service load balances the file system slaves by simply choosing the node who has received the least amount of requests so far.

## Encryption / Authentication
All client requests are behind a piece of middleware which examines the supplied token, attempts to decrypt it using the server key (known to all server nodes) and verify its contents. This middleware also sets the `clientId` (contained in the encrypted token) field of an incoming request (if it could be authenticated), allowing the controllers to know which client they are servicing. Finally, it also sets `req.decrypted` with the decrypted contents of the body of any POST requests.

## Client API
- Note any references to *files* on the directory service refer to the file meta data as described above, not the actual files them selves which are stored on the remote file system.

#### `GET /remoteFile/write`
- Returns an endpoint a client may write to (master node).

#### `GET /remoteFile/read?filename=<client_filepath>`
- Returns an endpoint a client may read a file from (slave node)

#### `GET /remoteFile/:_id
- Returns the filename given the file `_id`.
- Required by the caching service in order to update a local file when it is changed on remote as it only knows the `_id` of the remote file that has changed and not the client's name for that remote file.

#### `GET /remoteFiles`
- Returns an array of files that the client has on the remote file system

#### `GET /publicFiles/:email`
- Returns an array of files that a client with the email address specified has that are marked as public.

#### `POST /sharedFile`
- **body**
  - `clientFileName`: the client's desired name for this shared file
  - `ownerId`: the `_id` of the client who created this file.
  - `remoteFileId`: the `_id` of the file on the remote file system (what this directory service entry will point to).
- This method allows client's to share files.
- Once a client creates a public file, it may be added as a directory service entry for other clients, allowing the two clients to share the file (under different local names if they so wish).
- This is accomplished by looking up the file meta data object owned by `ownerId` with the appropriate `remoteFileId` and duplicating this file object into the client making the request's list of file objects. The only difference between these two objects will be the `clientFileName` which may be different even though the two clients are refering to the same physical file on the remote file sytem.


## Inter Service API
#### `POST /notify`
- **body**
  - `clientId`: `_id` of client who has just created this file
  - `file`: a file object as described in the schema above
- This endpoint is used by the remote file system master in order to inform the directory service that a new file has been created.
- The directory service then creates/updates the entry for the `clientId`, adding this `file` to its array of stored files for future access.
- This callback also decides on which slave nodes should be used to store the file (allowing for further load balancing) and sends this list back to the master node for replication.

#### `PUT /notify`
- **body**
  - `clientId`: the `_id` of the client who has just updated the file
  - `_id`: the `_id` of the file that has just been updated.
  - `filename`: the potentially new (if update was a rename) filename that the client is storing this file as locally.
- This endpoint is used by the file system master node to inform the directory service that a file has been updated.
- This is required if the update was a rename as subsequent requests from the client to the directory service will now use a different file name for this specific file. 
- This endpoint also sends back the list of slave nodes who have a copy of this file so that the master node can push the changes to all of the slave nodes who have the file.

#### `DELETE /remoteFile/:clientId/:_id`
- This endpoint is used by the file system master node to inform the directory service that a remote file has been deleted.
- The directory service can then update it's entry for `clientId` and remove the file `_id` from its array of files that it has stored.







