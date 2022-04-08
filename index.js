const express = require('express');
const v8 = require('v8');
const si = require('systeminformation');
const ping = require('ping');
const config = require("./params.js");

const app = express();
app.set("view engine", "ejs")
app.use(express.static('static'));
const logdb = require("./database")

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

app.get("/" , (req, res) => { res.render("service", config) })
app.post("/empty", (req, res) => {res.end();})
app.post("/p", async(req, res) => { res.json(stat);})

app.get("/auth", async(req, res)=> {
  const n = 100;
  const page = 1;
  const result = await logdb.get_data(n, page); 
  console.log(result);
  res.render("auth_log", {type:"list", result:result });
})

app.get("/ssh", async(req, res)=> {
  res.render("ssh_analisys", {});
})

app.get("/ssh-table", async(req, res)=> {
  const n = 100;
  const page = 1;
  const result = await logdb.get_ssh_auth_data(n, page); 
  console.log(result);
  res.render("auth_log", {type:"list", result:result });
})

app.get("/ssh_analisis", async(req, res) => {
  const data = await logdb.get_ssh_analitics();
  res.json(data);
})

app.get("/refresh_data", async(req, res)=> {
  res.send("ok")
  await logdb.create_table();
  // await logdb.clear_data();
  const pages = [
    // {name:"/var/log/auth.log", zipped:false },
    // {name:"/var/log/auth.log.2", zipped:false },
    // {name:"/var/log/auth.log.2.gz", zipped:true },
    // {name:"/var/log/auth.log.3.gz", zipped:true },
    {name:"./tmp/auth.log", zipped:false },
    {name:"./tmp/auth.log.1", zipped:false },
    {name:"./tmp/auth.log.2.gz", zipped:true },
    {name:"./tmp/auth.log.3.gz", zipped:true },
  ]
  for await (f of pages){
    await logdb.insert_syslog_data(f.name, f.zipped);
    console.log(f.name);
  }
  console.log("hoge")
  await logdb.insert_nginx_data("./tmp/access.log", false);
})

app.use((req, res, next) => {
    res.status(404).send("<h1>404 Page Not Found</h1>");
});

console.log("Server start on port ", config.port)
app.listen(config.port, () => {
    console.log('listening......');
});
