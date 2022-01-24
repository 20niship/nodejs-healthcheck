const config = {
    title:"Healthcheck",
    description:"description",
    url:"localhost",
    port:8000,
    dt: 10000,
    
    services:[
         {
             name: "google",
             ip : "google.com",
         },

         {
             name : "dns",
             ip : "1.1.1.1"
         },
    ],
    service_check_timeout:1, // in sec
    service_check_cron : 3000, // run service check each ?? ms
    performance_check_cron : 5000,

    enable_docker : false, // show docker container status
    enable_procs  : true, // show process status
    enable_users  : false, // show logined user status

    notify_slack :{
        storage_full : "",
        service_down : "",
        temperature : "",
    }
}

module.exports = config;
