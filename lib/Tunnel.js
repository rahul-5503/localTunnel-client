/* eslint-disable consistent-return, no-underscore-dangle */

const { parse } = require('url');
const { EventEmitter } = require('events');
const axios = require('axios');
const debug = require('debug')('localtunnel:client');
const fs = require('fs');
const TunnelCluster = require('./TunnelCluster');
const { log } = require('console');
const https = require('https');


module.exports = class Tunnel extends EventEmitter {
  constructor(opts = {}) {
    super(opts);
    this.opts = opts;
    this.closed = false;
    if (!this.opts.host) {
     // this.opts.host = 'https://localtunnel.me';
    //this.opts.host = 'http://192.168.1.8:80/';
    this.opts.host = 'https://tunnel.autosecnextgen.com/';
    }
  }

  _getInfo(body) {
    /* eslint-disable camelcase */
    const { id, ip, port, url, cached_url, max_conn_count } = body;
    const { host, port: local_port, local_host } = this.opts;
    const { local_https, local_cert, local_key, local_ca, allow_invalid_cert } = this.opts;
    return {
      name: id,
      url,
      cached_url,
      max_conn: max_conn_count || 1,
      remote_host: parse(host).hostname,
      remote_ip: ip,
      remote_port: port,
      local_port,
      local_host,
      local_https,
      local_cert,
      local_key,
      local_ca,
      allow_invalid_cert,
    };
    /* eslint-enable camelcase */
  }

  // initialize connection
  // callback with connection info
  _init(cb) {
    const opt = this.opts;
    const getInfo = this._getInfo.bind(this);

  //   const params = {
  //     responseType: 'json',
  //     httpsAgent: new https.Agent({
  //   rejectUnauthorized: false // Only for testing!
  // })
      const params = {
      responseType: 'json',
      httpsAgent: new https.Agent({
        cert: fs.readFileSync(opt.local_cert), // Pass in from command line
        key: fs.readFileSync(opt.local_key),
        ca: opt.local_ca ? fs.readFileSync(opt.local_ca) : undefined,
        rejectUnauthorized: false // or true if using valid certs
      })
    };
    //console.log("hostname",opt.host);
    
   //const baseUri = `http://192.168.1.8:80`;
   const baseUri = 'https://tunnel.autosecnextgen.com';
    //const baseUri = `${opt.host}/`;
    // no subdomain at first, maybe use requested domain
    const assignedDomain = opt.subdomain;
    console.log("domain",assignedDomain);
    //const assignedDomain = opt.subdomain?.replace('.' + new URL(opt.host).hostname, '');

    // where to quest
    const uri = `${baseUri}/${assignedDomain || '?new'}`;
    console.log("tunnel _init",uri,params,opt.host);
    (function getUrl() {
      axios
        .get(uri, params)
        .then(res => {
          const body = res.data;
          console.log("got tunnel information", res.data);
          debug('got tunnel information', res.data);
          if (res.status !== 200) {
            const err = new Error(
              (body && body.message) || 'localtunnel server returned an error, please try again'
            );
            return cb(err);
          }
          else{
            console.log(res.data)
          }
          cb(null, getInfo(body));
        })
        .catch(err => {
          debug(`tunnel server offline: ${err.message}, retry 1s`);
          return setTimeout(getUrl, 1000);
        });
    })();
  }

  _establish(info) {
    // increase max event listeners so that localtunnel consumers don't get
    // warning messages as soon as they setup even one listener. See #71
    //console.log("establish");
    this.setMaxListeners(info.max_conn + (EventEmitter.defaultMaxListeners || 10));

    this.tunnelCluster = new TunnelCluster(info);

    // only emit the url the first time
    this.tunnelCluster.once('open', () => {
      console.log("[Tunnel] : tunnel open",info.url);      
      this.emit('url', info.url);
    });

    // re-emit socket error
    this.tunnelCluster.on('error', err => {
      console.log("[Tunnel]: tunnelcluster.on",err.message);
      debug('got socket error', err.message);
      this.emit('error', err);
    });

    let tunnelCount = 0;

    // track open count
    this.tunnelCluster.on('open', tunnel => {
      tunnelCount++;
      debug('tunnel open [total: %d]', tunnelCount);
     console.log("[Tunnel] : tunnel open",tunnelCount);
     
      const closeHandler = () => {
        console.log("[Tunnel] : tunnel close");        
        tunnel.destroy();
      };
      console.log("[TUnnel] : tunnel connect");
      if (this.closed) {
        return closeHandler();
      }

      this.once('close', closeHandler);
      tunnel.once('close', () => {
        console.log("[Tunnel] : connectionclose")
        this.removeListener('close', closeHandler);
      });
    });

    // when a tunnel dies, open a new one
    this.tunnelCluster.on('dead', () => {
      tunnelCount--;
      console.log("[Tunnel] when tunnel dead open new",);
      debug('tunnel dead [total: %d]', tunnelCount);

      if (this.closed) {
        return;
      }
      this.tunnelCluster.open();
    });

    this.tunnelCluster.on('request', req => {
      this.emit('request', req);
    });

    // establish as many tunnels as allowed
    for (let count = 0; count < info.max_conn; ++count) {
      //console.log("[Tunnel] : for", count);
            
      this.tunnelCluster.open();
    }
  }

  open(cb) {
    this._init((err, info) => {
      console.log("open");
      
      if (err) {
        return cb(err);
      }
     console.log("after cb");
     
      this.clientId = info.name;
      this.url = info.url;

      // `cached_url` is only returned by proxy servers that support resource caching.
      if (info.cached_url) {
        this.cachedUrl = info.cached_url;
      }
     console.log("ageter cach ")
      this._establish(info);
      console.log("[Tunnel] : _establish")
      cb();
    });
  }

  close() {
    this.closed = true;
    this.emit('close');
  }
};
