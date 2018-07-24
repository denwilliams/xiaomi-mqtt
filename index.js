#!/usr/bin/env node
'use strict';

var dgram = require('dgram');
var Mqtt = require('./lib/mqtt.js').Mqtt;
var Utils = require('./lib/utils.js').Utils;
var log = require('loglevel');
const crypto = require('crypto');

var sidAddress = {};
var sidPort = {};
var token = {};
var payload = {};
var gateway_sid; // todo: multliple gateway

const IV = Buffer.from([0x17, 0x99, 0x6d, 0x09, 0x3d, 0x28, 0xdd, 0xb3, 0xba, 0x69, 0x5a, 0x2e, 0x6f, 0x58, 0x56, 0x2e]);
const package_name = Utils.read_packageName();
const package_version = Utils.read_packageVersion();
const config = Utils.loadConfig("config.json");

var serverPort = config.xiaomi.serverPort || 9898;
var multicastAddress = config.xiaomi.multicastAddress || '224.0.0.50';
var multicastPort =  config.xiaomi.multicastPort || 4321;
var password = config.xiaomi.password || "";
var level = config.loglevel || "info";

Utils.setlogPrefix(log);
log.setLevel(level);

log.info("Start "+package_name+", version "+package_version);
log.trace("config " + JSON.stringify(config, null, 2));

var params = {
  "config": config,
  "package_name": package_name,
  "get_id_list": get_id_list,
  "read": read,
  "write": write,
  "log": log
}

var mqtt = new Mqtt(params);
mqtt.connect();

const server = dgram.createSocket('udp4');
server.bind(serverPort);

sendWhois();

server.on('listening', function() {
  var address = server.address();
  log.info("Start a UDP server, listening on port "+address.port);
  server.addMembership(multicastAddress);
})

server.on('message', function(buffer, rinfo) {
  var msg;

  try {
    msg = JSON.parse(buffer);
    log.trace("msg "+JSON.stringify(msg));
  } catch (err) {
    log.error("invalid message: "+buffer);
    return;
  }

  switch (msg.cmd) {
    case "iam":
      log.trace("msg "+JSON.stringify(msg));
      var sid = msg.sid;
      sidAddress[sid] = msg.ip;
      sidPort[sid] = msg.port;
      gateway_sid = msg.sid;
      log.info("Gateway sid "+msg.sid+" Address "+sidAddress[sid]+", Port "+sidPort[sid]);
      get_id_list(sid);
      break;
    case "get_id_list_ack":
      var data = JSON.parse(msg.data);
      var sid;
      for(var index in data) {
        sid = data[index];
        sidAddress[sid] = rinfo.address;
        sidPort[sid] = rinfo.port;
      }
      log.trace(JSON.stringify(sidAddress)+ " "+JSON.stringify(sidPort))
      payload = {"cmd":msg.cmd, "sid":msg.sid, "data":JSON.parse(msg.data)};
      log.debug(JSON.stringify(payload));
      mqtt.publish(payload);
      break;
    case "read_ack":
    case "report":
      var data = JSON.parse(msg.data);
      switch (msg.model) {
        case "sensor_ht":
        case 'weather.v1':
          var temperature = data.temperature ? Math.round(data.temperature / 10.0) / 10 : null;
          if (temperature) {
            mqtt.publish(temperature, `status/${msg.model}/${msg.sid}/temperature`);
          }
          var humidity = data.humidity ? Math.round(data.humidity / 10.0) / 10: null;
          if (humidity) {
            mqtt.publish(humidity, `status/${msg.model}/${msg.sid}/humidity`);
          }
          payload = {"cmd":msg.cmd ,"model":msg.model, "sid":msg.sid, "short_id":msg.short_id, "data": {"voltage": data.voltage, "temperature":temperature, "humidity":humidity}};
          if (data.pressure) {
            mqtt.publish(Math.round(data.pressure / 100.0) / 10, `status/${msg.model}/${msg.sid}/pressure`);
          }
          if (data.voltage) {
            mqtt.publish(data.voltage, `status/${msg.model}/${msg.sid}/voltage`);
          }
          log.debug(JSON.stringify(payload));
          break;
        case "sensor_motion.aq2":
          if (data.lux) {
            mqtt.publish(parseInt(data.lux, 10), `status/${msg.model}/${msg.sid}/lux`);
          }
          if (data.status) {
            mqtt.publish(data.status, `status/${msg.model}/${msg.sid}/status`);
            mqtt.publish(new Date().toISOString(), `status/${msg.model}/${msg.sid}/${data.status}`);
          }
          if (data.no_motion) {
            mqtt.publish(parseInt(data.no_motion), `status/${msg.model}/${msg.sid}/no_motion`);
          }
        case "gateway":
          payload = {"cmd":msg.cmd ,"model":msg.model, "sid":msg.sid, "short_id":msg.short_id, "data": data};
          log.debug(JSON.stringify(payload));
          break;
        // case "magnet":
        case "sensor_switch.aq2":
          if (data.status) {
            mqtt.publish(new Date().toISOString(), `status/${msg.model}/${msg.sid}/${data.status}`);
          }
          payload = {"cmd":msg.cmd ,"model":msg.model, "sid":msg.sid, "short_id":msg.short_id, "data": data};
          break;
        case 'sensor_magnet.aq2':
          if (data.status) {
            mqtt.publish(data.status, `status/${msg.model}/${msg.sid}/status`);
            mqtt.publish(new Date().toISOString(), `status/${msg.model}/${msg.sid}/${data.status}`);
          }
          payload = {"cmd":msg.cmd ,"model":msg.model, "sid":msg.sid, "short_id":msg.short_id, "data": data};
          break;
        case "86sw2":
          if (data.channel_0) {
            mqtt.publish(new Date().toISOString(), `status/${msg.model}/${msg.sid}/channel_0/${data.channel_0}`);
          }
          if (data.channel_1) {
            mqtt.publish(new Date().toISOString(), `status/${msg.model}/${msg.sid}/channel_1/${data.channel_1}`);
          }
          if (data.dual_channel) {
            mqtt.publish(new Date().toISOString(), `status/${msg.model}/${msg.sid}/dual_channel/${data.dual_channel}`);
          }
          payload = {"cmd":msg.cmd ,"model":msg.model, "sid":msg.sid, "short_id":msg.short_id, "data": data};
          break;
        case "cube":
          console.log('TODO report', msg.model);
          console.log(msg);
          payload = {"cmd":msg.cmd ,"model":msg.model, "sid":msg.sid, "short_id":msg.short_id, "data": data};
          log.debug(JSON.stringify(payload));
          break;
        default:
          console.log('TODO report', msg.model);
          console.log(msg);
          payload = {"cmd":msg.cmd ,"model":msg.model, "sid":msg.sid, "short_id":msg.short_id, "data": data};
          log.debug("untested "+JSON.stringify(payload));
      }
      mqtt.publish(payload);
      break;
    case "write_ack":
      var data = JSON.parse(msg.data);
      payload = {"cmd":msg.cmd ,"model":msg.model, "sid":msg.sid, "short_id":msg.short_id, "data": data};
      log.debug(JSON.stringify(payload));
      mqtt.publish(payload);
      break;
    case "heartbeat":
      var data = JSON.parse(msg.data);
      if (msg.model === "gateway") {
        token[msg.sid] = msg.token;
      }
      payload = {"cmd":msg.cmd ,"model":msg.model, "sid":msg.sid, "short_id":msg.short_id, "token":msg.token, "data": data};
      if (msg.model !== "gateway") {
        log.debug(JSON.stringify(payload));
      }

      switch (msg.model) {
        case "sensor_ht":
        case "weather.v1":
          if (data.temperature) mqtt.publish(Math.round(data.temperature / 10.0) / 10, `status/${msg.model}/${msg.sid}/temperature`);
          if (data.humidity) mqtt.publish(Math.round(data.humidity / 10.0) / 10, `status/${msg.model}/${msg.sid}/humidity`);
          if (data.pressure) mqtt.publish(Math.round(data.pressure / 100.0) / 10, `status/${msg.model}/${msg.sid}/pressure`);
          if (data.voltage) mqtt.publish(data.voltage, `status/${msg.model}/${msg.sid}/voltage`);
          break;
        case "sensor_motion.aq2":
          if (data.lux) mqtt.publish(data.lux, `status/${msg.model}/${msg.sid}/lux`);
          if (data.status) {
            mqtt.publish(data.status, `status/${msg.model}/${msg.sid}/status`);
            mqtt.publish(new Date().toISOString(), `status/${msg.model}/${msg.sid}/${data.status}`);
          }
          if (data.no_motion) mqtt.publish(data.no_motion, `status/${msg.model}/${msg.sid}/no_motion`);
          if (data.voltage) {
            mqtt.publish(data.voltage, `status/${msg.model}/${msg.sid}/voltage`);
          }
          break;
        case 'sensor_magnet.aq2':
          if (data.status) {
            mqtt.publish(data.status, `status/${msg.model}/${msg.sid}/status`);
            mqtt.publish(new Date().toISOString(), `status/${msg.model}/${msg.sid}/${data.status}`);
          }
          if (data.voltage) {
            mqtt.publish(data.voltage, `status/${msg.model}/${msg.sid}/voltage`);
          }
          break;
        case 'plug':
          if (data.status) {
            mqtt.publish(data.status, `status/${msg.model}/${msg.sid}/status`);
            mqtt.publish(new Date().toISOString(), `status/${msg.model}/${msg.sid}/${data.status}`);
          }
          if (data.voltage) {
            mqtt.publish(data.voltage, `status/${msg.model}/${msg.sid}/voltage`);
          }
          if (data.inuse) {
            mqtt.publish(parseInt(data.inuse), `status/${msg.model}/${msg.sid}/inuse`);
          }
          if (data.power_consumed) {
            mqtt.publish(parseInt(data.power_consumed), `status/${msg.model}/${msg.sid}/power_consumed`);
          }
          if (data.load_power) {
            mqtt.publish(parseFloat(data.load_power), `status/${msg.model}/${msg.sid}/load_power`);
          }
          break;
        case 'sensor_cube.aqgl01':
          if (data.voltage) {
            mqtt.publish(data.voltage, `status/${msg.model}/${msg.sid}/voltage`);
          }
          break;
        case "gateway":
          break;
        // case "86sw2":
        // case "sensor_switch.aq2":
        // case "magnet":
        // case "switch":
        // case "cube":
        //   break;
        default:
          if (data.voltage) {
            mqtt.publish(data.voltage, `status/${msg.model}/${msg.sid}/voltage`);
          }
          console.log('TODO heartbeat', msg.model);
          console.log(msg);
          break;
      }

      mqtt.publish(payload);
      break;
    default:
      log.warn("unknown msg "+JSON.stringify(msg)+" from client "+rinfo.address+":"+rinfo.port);
  }
});

// https://nodejs.org/api/errors.html
server.on('error', function(err) {
  log.error("server.on('error') "+err.message);
  if (err.message.includes("EADDRINUSE")) {
    log.info("use 'lsof -i -P' to check for ports used.");
  }
  log.trace(err.stack);
  try {
    server.close();
  } catch(err) {
    log.error("server.close() "+err.message);
    log.trace(err.stack);
    process.exit(2);
  }
});

function sendWhois() {
  var msg = '{"cmd": "whois"}';
  log.trace("Send "+msg+" to a multicast address "+multicastAddress+":"+multicastPort);
  server.send(msg, 0, msg.length, multicastPort, multicastAddress);
}

function get_id_list(sid) {
  var msg = '{"cmd":"get_id_list"}';
  log.trace("Send "+msg+" to "+sidAddress[sid]+":"+sidPort[sid]);
  server.send(msg, 0, msg.length, sidPort[sid], sidAddress[sid]);
}

function read(sid) {
  if (sid in sidPort) {
    var msg = '{"cmd":"read", "sid":"' + sid + '"}';
    log.trace("Send "+msg+" to "+sidAddress[sid]+":"+sidPort[sid]);
    server.send(msg, 0, msg.length, sidPort[sid], sidAddress[sid]);
  } else {
    payload = {"cmd":"xm","msg":"sid >"+sid+"< unknown."};
    log.warn(JSON.stringify(payload));
    mqtt.publish(payload);
  }
}

function write(mqtt_payload) {

  var msg;
  payload = mqtt_payload;
  var sid = payload.sid;

  if (sid in sidPort) {
    try {
      var cipher = crypto.createCipheriv('aes-128-cbc', password, IV);
    } catch (e) {
      payload = {"cmd":"xm","msg":"Cipher "+JSON.stringify(cipher)+", check the password in config.json."};
      log.error(JSON.stringify(payload));
      mqtt.publish(payload);
      return;
    }

    if (token[gateway_sid]) {
      var key = cipher.update(token[gateway_sid], 'ascii', 'hex');
      payload.data.key = key;
      switch (payload.model) {
        case "gateway":
          if ("rgb" in payload.data) {
            payload.data.rgb = Utils.rgb_buf(payload.data.rgb);
          }
          break;
        default:
          // nothing
      }
      msg = JSON.stringify(payload);
      log.debug(msg);
      server.send(msg, 0, msg.length, sidPort[sid], sidAddress[sid]);
    } else {
      payload = {"cmd":"xm","msg":"gateway token unknown."};
      log.warn(JSON.stringify(payload));
      mqtt.publish(payload);
    }
  } else {
    payload = {"cmd":"xm","msg":"sid >"+sid+"< unknown."};
    log.warn(JSON.stringify(payload));
    mqtt.publish(payload);
  }
}
