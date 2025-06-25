const { EventEmitter } = require('events');
const debug = require('debug')('localtunnel:client');
const fs = require('fs');
const net = require('net');
const tls = require('tls');

const HeaderHostTransformer = require('./HeaderHostTransformer');

// manages groups of tunnels
module.exports = class TunnelCluster extends EventEmitter {
  constructor(opts = {}) {
    super(opts);
    this.opts = opts;
  }

  open() {
    const opt = this.opts;

    // Prefer IP if returned by the server
    const remoteHostOrIp = opt.remote_ip || opt.remote_host;
    const remotePort = opt.remote_port;
    const localHost = opt.local_host || 'localhost';
    const localPort = opt.local_port;
    const localProtocol = opt.local_https ? 'https' : 'http';
    const allowInvalidCert = opt.allow_invalid_cert;
    console.log('establishing tunnel %s://%s:%s <> %s:%s',
      localProtocol,
      localHost,
      localPort,
      remoteHostOrIp,
      remotePort);
    
    debug(
      'establishing tunnel %s://%s:%s <> %s:%s',
      localProtocol,
      localHost,
      localPort,
      remoteHostOrIp,
      remotePort
    );

    console.log("[Tunnelcluster] remote",remoteHostOrIp,remotePort);
    // connection to localtunnel server
    const remote = net.connect({
      host: remoteHostOrIp,
      port: remotePort,
      //timeout:10000,
    });

    remote.on('timeout', () => {
  console.error(`[TunnelCluster] : Connection to ${remoteHostOrIp}:${remotePort} timed out`);
  remote.destroy();
  this.emit('dead');
});
    console.log("[TunnelCluster]:remote connect")
    remote.setKeepAlive(true);

    remote.on('error', err => {
      debug('got remote connection error', err.message);

      // emit connection refused errors immediately, because they
      // indicate that the tunnel can't be established.
      if (err.code === 'ECONNREFUSED') {
        this.emit(
          'error',
          new Error(
            `connection refused: ${remoteHostOrIp}:${remotePort} (check your firewall settings)`
          )
        );
      }

      remote.end();
    });

    const connLocal = () => {
      console.log("[Tunnel] : connLocal")
      if (remote.destroyed) {
        console.log("remote destroyed");
        debug('remote destroyed');
        this.emit('dead');
        return;
      }
      console.log('[TunnelCluster] : connecting locally to %s://%s:%d', localProtocol, localHost, localPort);
      
      debug('connecting locally to %s://%s:%d', localProtocol, localHost, localPort);
      remote.pause();

      if (allowInvalidCert) {
        console.log("[TunnelCluster] : allowinvalidcert")
        debug('allowing invalid certificates');
      }

      const getLocalCertOpts = () =>
        allowInvalidCert
          ? { rejectUnauthorized: false }
          : {
              cert: fs.readFileSync(opt.local_cert),
              key: fs.readFileSync(opt.local_key),
              ca: opt.local_ca ? [fs.readFileSync(opt.local_ca)] : undefined,
            };

      // connection to local http server
      const local = opt.local_https
        ? tls.connect({ host: localHost, port: localPort, ...getLocalCertOpts() })
        : net.connect({ host: localHost, port: localPort });

      const remoteClose = () => {
        debug('remote close');
        //console.log("[Tunnel] : remote close");
        
        this.emit('dead');
        local.end();
      };

      remote.once('close', remoteClose);

      // TODO some languages have single threaded servers which makes opening up
      // multiple local connections impossible. We need a smarter way to scale
      // and adjust for such instances to avoid beating on the door of the server
      local.once('error', err => {
        console.log('error',err.message);
        debug('local error %s', err.message);
        local.end();

        remote.removeListener('close', remoteClose);

        if (err.code !== 'ECONNREFUSED'
            && err.code !== 'ECONNRESET') {
          return remote.end();
        }

        // retrying connection to local server
        setTimeout(connLocal, 1000);
      });

      local.once('connect', () => {
        console.log("[TUnnelCluster] : connect loccally",);
        
        debug('connected locally');
        remote.resume();

        let stream = remote;

        // if user requested specific local host
        // then we use host header transform to replace the host header
        if (opt.local_host) {
          debug('transform Host header to %s', opt.local_host);
          console.log("[TunnelCLuster] : transform host heaser".opt.local_host);
          
          stream = remote.pipe(new HeaderHostTransformer({ host: opt.local_host }));
        }

        stream.pipe(local).pipe(remote);

        // when local closes, also get a new remote
        local.once('close', hadError => {
          debug('local connection closed [%s]', hadError);
        });
      });
    };
    //console.log("[TunnelCluster]: remoter.on");
    remote.on('data', data => {      
      const match = data.toString().match(/^(\w+) (\S+)/);
      console.log("[TunnelCLuste] : remote.on data",data ,"match",match);
      if (match) {      
        this.emit('request', {
          method: match[1],
          path: match[2],
        });
      }
    });
   // console.log("[TunnelCluster]: remoter.once");
    // tunnel is considered open when remote connects
    remote.once('connect', () => {
      console.log("[TunnelCluster] : connection");
      this.emit('open', remote);
      connLocal();
    });
  }
};
