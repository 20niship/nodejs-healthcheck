const express = require('express');
const v8 = require('v8');
const si = require('systeminformation');
const ping = require('ping');

const config = require("./params.js");
const { setgid } = require('process');

const app = express();
app.use(express.static('static'));

app.get("/" , (req, res) => {
    res.render(__dirname + "/index.ejs", config)
})

app.post("/empty", (req, res) => {
    res.end();
})


// service ping check
let services = [];
setInterval(async() =>  {
    let services_tmp = []
    for(let host of config.services){
        const ip = host.ip;
        const name = host.name;
        let res = await ping.promise.probe(ip, { timeout: config.service_check_timeout });
        services_tmp.push({name : name, res});
    }
    services = services_tmp;
}, config.service_check_cron);

let stat = {};
setInterval(async() =>  {
    stat = {
        cpu : {
            speed : (await si.cpuCurrentSpeed()).cores,
            temp  : (await si.cpuTemperature()).cores,
            load  : await si.currentLoad(),
        },
        memory : await si.mem(),
        ctime  : Date.now(),
        disk   : await si.fsSize(),
        heap   : v8.getHeapStatistics(),
        battery: (await si.battery()),
        users  : (await si.users()),
        procs  : (await si.processes()),
        dockers  : (await si.dockerContainers(true)),
        services : services
    }
}, config.performance_check_cron);

app.post("/p", async(req, res) => {
    res.json(stat);
})
  
app.use((req, res, next) => {
    res.status(404).send("<h1>404 Page Not Found</h1>");
});

console.log("Server start on port ", config.port)
app.listen(config.port, () => {
    console.log('listening......');
});
