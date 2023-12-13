require('dotenv').config()
const mqtt = require('mqtt');
const request = require('request');
const date = require('date-and-time');
const Promise = require("bluebird");
const fs = require('fs');

const log = (message, level) => {

  const currentDateTime = date.format(new Date(), 'YYYY-MM-DD HH:mm:ss [GMT]Z');

  switch (level) {
    case 'warn':
      console.warn(`${currentDateTime} [WARN] ${message}`)
      break;

    case 'error':
      console.error(`${currentDateTime} [ERROR] ${message}`)
      break;

    default:
      console.log(`${currentDateTime} [INFO] ${message}`)
      break;
  }
}

const expiresInSec = 10000
const accessTokenFile = "last_accesstoken.txt";

let mqttTopicPrefix = "netatmo";
let baseUrl = "https://api.netatmo.com"
let publishIntervalSeconds = 30;

const requiredEnvs = ["CLIENT_ID", "CLIENT_SECRET", "REFRESH_TOKEN", "HOME_ID", "MQTT_HOST"]

requiredEnvs.forEach(env => {
  if (process.env[env] === undefined) {
    log(`Missing ${env} variable is missing. Exiting...`, 'warn');
    process.exit(1);
  }
});

if (process.env.BASEURL !== undefined) {
  baseUrl = process.env.BASEURL
}
if (process.env.INTERVAL !== undefined) {
  publishIntervalSeconds = process.env.INTERVAL
}

if (process.env.MQTT_TOPIC_PREFIX !== undefined) {
  mqttTopicPrefix = process.env.MQTT_TOPIC_PREFIX
}

let homeId = process.env.HOME_ID;
let clientId = process.env.CLIENT_ID;
let clientSecret = process.env.CLIENT_SECRET;
let accessToken = "";
let refreshToken = process.env.REFRESH_TOKEN;

let expireDate = new Date();
let hasError = false;

/*
if (fs.existsSync(accessTokenFile)) {
  fs.stat(accessTokenFile, (error, stats) => {
    if (error) {
      log(`Error while accessing ${accessTokenFile}: ${error}`, 'error');
    }
    if (date.addSeconds(stats.mtime, expiresInSec) < new Date()) {
      const fileContent = fs.readFileSync(accessTokenFile);
      if (fileContent !== null && fileContent !== undefined && stats.size > 0) {
        log("Using local stored accessToken", 'info');
        accessToken = fileContent;
      }
    }
  });
}*/

let mqttOptions = {
  clientId: "netatmobridge",
  protocol: "mqtt",
  host: process.env.MQTT_HOST,
  port: 1883
}

if (process.env.MQTT_USER && process.env.MQTT_PASSWORD) {
  mqttOptions["username"] = process.env.MQTT_USER;
  mqttOptions["password"] = process.env.MQTT_PASSWORD;
}

const mqttClient = mqtt.connect(mqttOptions);

let firstConnected = false;

mqttClient.on("connect", () => {
  if (firstConnected) {
    log(`Connected to mqtt host ${process.env.MQTT_HOST}.`, 'info');
    firstConnected = true;
  }
});

mqttClient.on("error", (error) => {
  log(`Could not connect to mqtt host ${process.env.MQTT_HOST}\n${error}`, 'error');
  process.exit(1);
});

mqttClient.on("end", () => {
  log(`Connection to MQTT broker ${process.env.MQTT_HOST} ended`, 'warn');
  process.exit(1);
});

mqttClient.on("reconnectnd", () => {
  log(`Reconnecting  to MQTT broker ${process.env.MQTT_HOST}`, 'info');
});

const NAModuleType_Name = (code) => {
  switch (code) {
	//hlavni stanice
	case 'NAMain': return "Smart Home Weather station"
	//venkovni modul
	case 'NAModule1': return "Smart Outdoor Module"
	//anometr
	case 'NAModule2': return "Smart Anemometer Module"
	//srazkovy sensor
	case 'NAModule3': return "Smart Rain Gauge Module"
	//domaci sensor
	case 'NAModule4': return "Smart Indoor Module"
	default: return code
  }
}
const NAModuleType_ShortName = (code) => {
  switch (code) {
	//hlavni stanice
	case 'NAMain': return `netatmo_main`
	//venkovni modul
	case 'NAModule1': return `netatmo_outdoor`
	//anometr
	case 'NAModule2': return `netatmo_anemometer`
	//srazkovy sensor
	case 'NAModule3': return `netatmo_rain`
	//domaci sensor
	case 'NAModule4': return `netatmo_indoor`
	default: return code
  }
}

const config_diagnostic = (diagnostic) => {
  if(diagnostic) {
    return `"entity_category": "diagnostic","enabled_by_default":false,`
    //return `"entity_category": "diagnostic",`
  } else {
    return ``
  }
}
const config_icon = (icon) => {
  if(icon != "") {
    return `"icon": "${icon}",`
  } else {
    return ``
  }
}
const config_device_class = (device_class) => {
  if(device_class != "") {
    return `"device_class": "${device_class}",`
  } else {
    return ``
  }
}
  
const ha_config_publish = (topicConfig, topicState, module, value_name) => {
  let id = module.id.replaceAll(":", "")
  var device_class = ""
  var unit = ""
  var icon = ""
  var name = ""

  if (value_name == "temperature"     ) { device_class = "temperature"   ; unit = "\u00b0C"; name = "Teplota"} 
  else if (value_name == "humidity"   ) { device_class = "humidity"      ; unit = "%"      ; name = "Vlhkost"} 
  else if (value_name == "co2"        ) { device_class = "carbon_dioxide"; unit = "ppm"    ; name = "CO2"} 
  else if (value_name == "noise"      ) { icon = "mdi:ear-hearing"       ; unit = "dB"     ; name = "Hluk"} 
  else if (value_name == "pressure"   ) { device_class = "pressure"      ; unit = "hPa"   ; name = "Tlak"} 
  else if (value_name == "absolute_pressure") { device_class = "pressure"; unit = "hPa"   ; name = "Tlak absolutní"} 

  else if (value_name == "rain"       ) { icon = "mdi:weather-rainy"; unit = "mm"; name = "Stážky"} 
  else if (value_name == "sum_rain_1" ) { icon = "mdi:weather-rainy"; unit = "mm"; name = "Stážky hodina"} 
  else if (value_name == "sum_rain_24") { icon = "mdi:weather-rainy"; unit = "mm"; name = "Stážky dnes"} 

  else if (value_name == "wind_strength"  ) { device_class = "wind_speed" ; unit = "m/s"   ; name = "Síla větru"} 
  else if (value_name == "wind_angle"     ) { icon = "mdi:compass-outline"; unit = "\u00b0"; name = "Úhel větru"} 
  else if (value_name == "wind_gust"      ) { device_class = "wind_speed" ; unit = "m/s"   ; name = "Poryv větru"} 
  else if (value_name == "wind_gust_angle") { icon = "mdi:compass-outline"; unit = "\u00b0"; name = "Úhel poryvu"} 

  else if (value_name == "battery_state") { icon = "mdi:battery"; unit = ""; name = "Baterie"} 
 
  let diagnostic_valueName = ["wifi_strength", "wifi_state", "battery_state", "battery_level", "rf_state", "rf_strength", "reachable"]
  let diagnostic = diagnostic_valueName.some(v => value_name.includes(v))
  
  let msg = `{`+
    `"state_topic": "${topicState}",`+
    config_device_class(device_class)+ 
    config_icon(icon)+
    config_diagnostic(diagnostic)+
    `"name": "${name}",`+
    `"unit_of_measurement": "${unit}",`+ 
    `"value_template": "{{ value_json.${value_name} }}",`+ 
    `"unique_id": "${NAModuleType_ShortName(module.type)}_${id}_${value_name}",`+  //opravdovy unikat
    `"object_id": "${NAModuleType_ShortName(module.type)}_${value_name}",`+  //entity_id
    `"device": {`+
      `"name": "Netatmo ${NAModuleType_Name(module.type)}",`+
      `"identifiers": "${id}",`+
      `"model": "${NAModuleType_Name(module.type)}",`+
      `"manufacturer": "Netatmo",`+
      `"sw_version":"${module.firmware_revision.toString()}"`+
    `},`+
    `"platform": "mqtt"`+
  `}`

  mqttClient.publish(`${topicConfig}${value_name}/config`, msg);
}

const convertToMQTT = (data) => {
  if (data.status === "ok") {

    var home = data.body.home

    let deviceTopicState = `${mqttTopicPrefix}/${home.id}/`
    let deviceTopicConfig = `homeassistant/sensor/${home.id}/`
    
    if(!home.hasOwnProperty("modules")) {
      log("No json property 'modules'", 'info');
      return;
    }

    if (mqttClient.connected) {
      log("Publishing device data via mqtt", 'info')
      
      home.modules.forEach(module => {
        let moduleId = module.id.replaceAll(":", "")
        let topicState = `${deviceTopicState}${moduleId}/state`
        let topicConfig = `${deviceTopicConfig}${moduleId}_`
        
        if(module.type == "NAMain") {
          ha_config_publish(topicConfig, topicState, module, "wifi_state");
          ha_config_publish(topicConfig, topicState, module, "wifi_strength");
        } else {
          ha_config_publish(topicConfig, topicState, module, "battery_state");
          ha_config_publish(topicConfig, topicState, module, "battery_level");
          ha_config_publish(topicConfig, topicState, module, "rf_state");
          ha_config_publish(topicConfig, topicState, module, "rf_strength");
          ha_config_publish(topicConfig, topicState, module, "reachable");
        }
        
        switch (module.type) {
          //hlavni stanice
          case 'NAMain':  
            ha_config_publish(topicConfig, topicState, module, "temperature");
            ha_config_publish(topicConfig, topicState, module, "humidity");
            ha_config_publish(topicConfig, topicState, module, "co2");
            ha_config_publish(topicConfig, topicState, module, "noise");
            ha_config_publish(topicConfig, topicState, module, "pressure");
            ha_config_publish(topicConfig, topicState, module, "absolute_pressure");
            break;
          
            //venkovni modul
          case 'NAModule1':   
            ha_config_publish(topicConfig, topicState, module, "temperature");
            ha_config_publish(topicConfig, topicState, module, "humidity");
            break;

          //anometr
          case 'NAModule2':   
            //prevedu na m/s a zaokrouhlim na 2 des. mista
            module.wind_strength = Math.round(module.wind_strength / 3.6 * 100)/100;
            module.wind_gust = Math.round(module.wind_gust / 3.6 * 100)/100; 

            ha_config_publish(topicConfig, topicState, module, "wind_strength");
            ha_config_publish(topicConfig, topicState, module, "wind_angle");
            ha_config_publish(topicConfig, topicState, module, "wind_gust");
            ha_config_publish(topicConfig, topicState, module, "wind_gust_angle");
            break;

          //srazkovy sensor
          case 'NAModule3':   
            ha_config_publish(topicConfig, topicState, module, "rain");
            ha_config_publish(topicConfig, topicState, module, "sum_rain_1");
            ha_config_publish(topicConfig, topicState, module, "sum_rain_24");
            break;

          //domaci sensor
          case 'NAModule4':   
            ha_config_publish(topicConfig, topicState, module, "temperature");
            ha_config_publish(topicConfig, topicState, module, "humidity");
            ha_config_publish(topicConfig, topicState, module, "co2");
            break;

          default:
            break;  
        }
            
        mqttClient.publish(topicState, JSON.stringify(module));
      });
    }
  }
}

const doTokenRefresh = () => {
//log("1", 'info')
  if (expireDate < new Date() || accessToken == "") {
//log("11", 'info')
    request.post(
      {
        url: `${baseUrl}/oauth2/token`,
        form: {
          grant_type: "refresh_token",
          refresh_token: refreshToken,
          client_id: clientId,
          client_secret: clientSecret
        }
      },
      (error, response, body) => {
        if (!error && response.statusCode == 200) {
//log("12", 'info')
          const jsonResult = JSON.parse(body);
          accessToken = jsonResult.access_token;
          refreshToken = jsonResult.refresh_token;
          expireDate = date.addSeconds(new Date(), jsonResult.expires_in - 800);
          
          fs.writeFileSync(accessTokenFile, accessToken);
          log(`Updated netatmo api refresh token and saved it under ${accessTokenFile}`, 'info')
        }
        else {
//log("13", 'info')
          hasError = true;
          log(JSON.stringify(response, null, 3), "warn");
          log(error, "error");
        }
      }
    )
  }
}

const getHomeStatus = () => {
//log("0", 'info')
  doTokenRefresh();
  
  if(accessToken != "") {
//log("01", 'info')
    request.get(`${baseUrl}/api/homestatus?home_id=${homeId}`,
      {
        headers: {
          "Authorization": `Bearer ${accessToken}`
        }
      }, (error, response, body) => {
        if (!error && response.statusCode == 200) {
//log("02", 'info')
          const jsonResult = JSON.parse(body);
          convertToMQTT(jsonResult);
        } else {
//log("03", 'info')
          hasError = true;
          log(JSON.stringify(response, null, 3), "warn");
          log(error, "error");
//          mqttClient.end(true);
//          process.exit(1);
        }
      }
    );
  } else {
//log("04", 'info')
    hasError = true;
    log(`accessToken EMPTY`, 'warn')
  }
}

const publishNetatmo = () => {
  if (hasError) {
    log("publishNetatmo: hasError=true", "error");
    
//    mqttClient.end(true);
//    process.exit(1);

    //pokud dojde k chybe komunikace, pockam 10s a zkusim znovu
    hasError = false;
    return Promise.delay(10 * 1000).then(() => publishNetatmo());
  
  } else {
    log("Getting station data", 'info')
    getHomeStatus();
    
    if (hasError) {
      //pokud dojde k chybe komunikace, pockam 10s a zkusim znovu
      return Promise.delay(10 * 1000).then(() => publishNetatmo());
    } else {
      return Promise.delay(publishIntervalSeconds * 1000).then(() => publishNetatmo());
    }
  }
}

publishNetatmo();