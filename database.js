"use struct";

const mysql = require('mysql2/promise');
const fs = require('fs');
const zlib     = require('zlib');
const readline = require('readline');
const geoip = require('geoip-lite');
const nginx_parser = require("nginx-log-parser")

const SYSLOG_LINE_REGEX = new RegExp([
	/(<[0-9]+>)?/, // 1 - optional priority
	/([a-z]{3})\s+/, // 2 - month
	/([0-9]{1,2})\s+/, // 3 - date
	/([0-9]{2}):/, // 4 - hours
	/([0-9]{2}):/, // 5 - minutes
	/([0-9]{2})/, // 6 - seconds
	/(\s+[\w.-]+)?\s+/, // 7 - host
	/([\w\-().0-9/]+)/, // 8 - process
	/(?:\[([a-z0-9-.]+)\])?:/, // 9 - optional pid
	/(.+)/ // 10  message
].map(regex => regex.source).join(''), 'i');

const FACILITY = ['kern','user','mail','daemon','auth','syslog','lpr','news','uucp','cron','authpriv','ftp','ntp','logaudit','logalert','clock','local0','local1','local2','local3','local4','local5','local6','local7' ];
const SEVERITY = ['emerg','alert','crit','err','warning','notice','info','debug' ];
const MONTHS = [ 'Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec' ];

const parse  = (log) => {
	const parts = SYSLOG_LINE_REGEX.exec(log.trim());
	if (!parts) { return {}; }

	const priority = Number((parts[1] || '').replace(/[^0-9]/g, ''));
	const facilityCode = priority >> 3;
	const facility = FACILITY[facilityCode];
	const severityCode = priority & 7;
	const severity = SEVERITY[severityCode];

	const month = MONTHS.indexOf(parts[2]);
	const date = Number(parts[3]);
	const hours = Number(parts[4]);
	const minutes = Number(parts[5]);
	const seconds = Number(parts[6]);

	const time = new Date();
	time.setMonth(month);
	time.setDate(date);
	time.setHours(hours);
	time.setMinutes(minutes);
	time.setSeconds(seconds);

	const host = (parts[7] || '').trim();
	const processName = parts[8];
	const pid = Number(parts[9]);

	const message = parts[10].trim();

	const result = {
		priority: priority,
		facilityCode: facilityCode,
		facility: facility,
		severityCode: severityCode,
		severity: severity,
		time: time,
/*
	month : MONTHS.indexOf(parts[2]),
	date : Number(parts[3]),
	hours : Number(parts[4]),
	minutes : Number(parts[5]),
	seconds : Number(parts[6]),
*/
    host: host,
		process: processName,
		message: message,
    pid: (pid) ? pid : -1
	};
	return result;
};


class LogManager{
  constructor(){
    this.connection = null;
    this.connected = false;
    this.setup();
  }

  async setup(){
    this.connection = await mysql.createConnection({
      host: 'localhost',
      user: 'docker',
      password:"docker_password",
      database: 'test_database',
      port:3306,
      multipleStatements: true
    });

    console.log("connecting .......")
  
    const connection_ok = await this.connection.connect((err) => {
      if (err) {
        this.connected = false;
        console.log("[ ERROR ] Database connection failed!!")
      }else{
        this.connected = true;
        console.log("Database connection success!!")
      }
    });
    console.log("connection : ")
  }

  getConnection(){
    return this.connection;
  }

async create_table(){
  const result = await this.connection.execute("CREATE TABLE IF NOT EXISTS auth_log (priority INT, facility_code INT, severity INT, time DATETIME, host TEXT,  proccess TEXT, message TEXT, pid INT);");
  const result2 = await this.connection.execute("CREATE TABLE IF NOT EXISTS ssh_log (time DATETIME, ip TEXT, port INT, user TEXT, status INT, lon FLOAT, lat FLOAT, country TEXT, message TEXT);");
  const result3 = await this.connection.execute("CREATE TABLE IF NOT EXISTS iptables_log (time DATETIME, ip TEXT, port INT, user TEXT, status INT, lon FLOAT, lat FLOAT, country TEXT, message TEXT);");
  const result4 = await this.connection.execute("CREATE TABLE IF NOT EXISTS nginx_log (time DATETIME, ip TEXT, port INT, user TEXT, status INT, lon FLOAT, lat FLOAT, country TEXT, message TEXT);");
  console.log(result);
}

async clear_data(){
  await this.connection.execute("DELETE from auth_log;");
  await this.connection.execute("DELETE from ssh_log;");
}

async insert_iptables_data(path, is_zipped = false){
  const rs = is_zipped ? 
    fs.createReadStream(path).pipe(zlib.createGunzip()) : 
    fs.createReadStream(path);
  const rl = readline.createInterface({ input:rs });
  const ait = rl[Symbol.asyncIterator]();
  while(1){
    const nextLine = await ait.next();
    if(nextLine.done) return;
    const line = nextLine?.value;
    if(!line.match("IN=")) continue;

    const timestamp = [...line.match(/([A-Za-z]+) ([0-9]{1,2}) ([0-9]{1,2}):([0-9]{1,2}):([0-9]{1,2}) /)];
    const arr = [...line.matchAll(/([^ ]+)=([^ ]+)/g)];
    const values = Object.assign({}, ...arr.map((x) => ({[x[1]]: x[2]})));
    console.log(values);
  }
}

async insert_nginx_data(path, is_zipped=false){
  const rs = is_zipped ? 
    fs.createReadStream(path).pipe(zlib.createGunzip()) : 
    fs.createReadStream(path);
  const rl = readline.createInterface({ input:rs });
  const ait = rl[Symbol.asyncIterator]();
  const parser = nginx_parser('$http_client_ip $remote_addr - $remote_user [$time_local] "$request" $status $body_bytes_sent "$http_referer" "$http_user_agent" "$upstream_response_time" $request_time $host $upstream_status $upstream_addr $http_deviceType $http_productId $http_appVersion $http_market');
  while(1){
    const nextLine = await ait.next();
    if(nextLine.done) return;
    const line = nextLine?.value;
    const parsed = parser(line);
    console.log(parsed);
  }
}

async insert_syslog_data(path, is_zipped = false){
    const rs = is_zipped ? 
    fs.createReadStream(path).pipe(zlib.createGunzip()) : 
    fs.createReadStream(path);
    const rl = readline.createInterface({ input:rs });
    const ait = rl[Symbol.asyncIterator]();
    while(1){
      const pnext = await ait.next();
      if(pnext.done) return;
      const line = pnext.value;
      const p = parse(line);
      if(Object.keys(p).length === 0) continue;

      const vaules = [p.priority, p.facilityCode, p.severityCode, p.time, p.host, p.process, p.message, p.pid];
      const [res, err] = await this.connection.query("INSERT INTO auth_log VALUES(?, ?, ?, ?, ?, ?, ?, ?);", vaules);
      if(p.process === "sshd"){ 
        const msg = p.message;
        const ip_ = msg.match(/([0-9]{1,3}\.){3}[0-9]{1,3}/);
        const ip = ip_ ? ip_[0] : "";
        const port_ = msg.match(/port [0-9]{1,5}/); 
        const port = port_ ? port_[0].replace("port ", "") : "";
        const user_ = msg.match(/[u|U]ser \w+ /); 
        const user = user_ ? user_[0].replace(/[u|U]ser/, "").replace(" ", "") : "";

        // message types : 
        const msg_template_strs = [
          "Disconnected from invalid user ",
          "error: kex_exchange_identification",
          "maximum authentication attempts exceeded for invalid user",
          "Too many authentication failures",
          "Disconnecting invalid user",
          "nvalid user ",
          "Unable to negotiate with ",
          "session closed for user ",
          "session opened for user ",
          "Disconnected from user",
          "not allowed because not listed in AllowUsers",
          "Received disconnect from ",
          "Connection closed by authenticating user",
          "Connection closed by remote host",
          "Connection closed by ",
          "Connection reset by ",
          "Disconnected from ",
          "Accepted publickey for ",
        ]
        let status=-1;
        for(let i=0; i<msg_template_strs.length; i++){
          if(msg.match(msg_template_strs[i])) { status = i; break; }
        }
        const ipinfo = geoip.lookup(ip);
        const cnt = ipinfo?.country || "";
        const ll = ipinfo?.ll || [0,0];
        const values_ssh = [p.time, ip, parseInt(port) || 0, user, status, ll[0], ll[1], cnt, p.message];
        const [rows, err2] = await this.connection.query("INSERT INTO ssh_log VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?);", values_ssh);
        if(err2){
          console.log(rows);
          console.log(values_ssh);
        }
      }
      if(err){
        console.log(vaules);
        console.log(result);
      }
  };
}
async get_data(n=100, page=0){
  const values = [n, (page+1)*n];
  console.log(values);
  const [r, f, e] = await this.connection.query("SELECT * FROM auth_log LIMIT ?, ?", values)
  return r;
}
async get_ssh_auth_data(n=100, page=0){
  const values = [n, (page+1)*n];
  console.log(values);
  const [r, f, e] = await this.connection.query("SELECT * FROM ssh_log LIMIT ?, ?", values)
  return r;
}

async get_ssh_analitics(){
  let r, e;
  [r, e] = await this.connection.query(` \
    select count(*) as sum from ssh_log; \
    select count(*) as n, country from ssh_log group by country order by count(*) desc limit 50; \ 
    select count(*) as n, user from ssh_log group by user having user != ' ' order by count(*) desc limit 50; \
    select count(*) as n, user from ssh_log where status=9 OR status=1 group by user having user != ' ' order by count(*) desc limit 50; \
    select count(*) as n, hour(time) as l from ssh_log group by hour(time); \ 
    select count(*) as n, day(time) as l from ssh_log group by day(time); \ 
    select count(*) as n, month(time) as l from ssh_log group by month(time); \ 
    select count(*) as n, year(time) as l from ssh_log group by year(time); \ 
    select count(*) as today_access from ssh_log where DATE(time) = CURDATE(); \ 
    select count(*) as month_access from ssh_log where month(time) = month(CURDATE()); \ 
    select count(*) as year_access from ssh_log where year(time) = year(CURDATE()); \ 
    select count(*) as n, status from ssh_log group by status; \
    select count(*) as n, country as l from ssh_log where country != "" group by country order by count(*) desc limit 50; \
    select * from ssh_log where (status = 9) ; \
    select country,time,user,ip from ssh_log where country!="" limit 50; \
    select country,time,user,ip from ssh_log limit 100; \
  `);
  const access_all = r[0]?.sum || 0;
  return r;
}

}

let dbManager = new LogManager();
module.exports = dbManager;

