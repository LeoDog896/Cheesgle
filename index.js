/* SETTINGS AND LONG DESCRIPTIONS */
const reliableSitesFile = './reliableSites.json' // Site hosts (don't include the https://) that can have more pages queued per 10 minutes and that have a lil tick next to them in search results.
// The reliableSites will re-require every minute.

const nonReliableLimitPer10Minutes = 150 // The limit of pages that can be queued per non-reliable site in 10 minute intervals

const reliableLimitPer10Minutes = 1000 // The limit of pages that can be queued per reliable site in 10 minute intervals

const pageSize = 15 // How many results to show for each page

const host = `https://cheesgle.codingmaster398.repl.co/` // Where cheesgle is being hosted

const blockUrlsThatInclude = ['facebook.com/c','twitter.com/share','creativecommons','t/contact_us','new/new'] // Any URLS with this inside them will not be able to be queued

const siteCap = 50000 // Maximum amount of pages that can be stored. If the amount of sites stored goes over this, adding pages to the queue won't work until pages are removed to go under this limit or the limit is increased.

const maxConnections = 500 // Maximum connections the crawler can have at once (see npm package "crawler"). More than 1000 can slow the site when crawling. 500 is reccomended.

const queueSuccessfulMessage = `We have queued the page successfully, and will now attempt to crawl it. If we are successful, the page should appear in search results in ~10 minutse. Thank you for your input. You can now go back to Cheesgle.`

const rateLimit = require('express-rate-limit')

const sumbitPageRateLimit = rateLimit({
	windowMs: 60 * 60 * 1000, // 1 hour
	max: 100,
	message:
		"This IP has requested we crawl a bunch of websites, and under the rules of this Cheesgle's owner, we're gonna block you from adding any more for a bit.",
	standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
	legacyHeaders: false, // Disable the `X-RateLimit-*` headers
})

/* Requiring and init of database */

const SitemapXMLParser = require('sitemap-xml-parser');
const robotsParser = require('robots-txt-parser');
const {performance} = require('perf_hooks');
var jsonpack = require("jsonpack")
var Crawler = require("crawler");
const Fuse = require('fuse.js')
var fs = require("fs")

/* DB init */
var db = jsonpack.unpack(fs.readFileSync("./db.txt",{encoding:'utf8'}))
console.log(Object.keys(db))

/* Reliable sites init */
var reliableSites = require(reliableSitesFile)
setInterval(function(){reliableSites=require(reliableSitesFile)},60000)

/* Crawling logic (messy code ahead) */

var noCrawl = [] // Don't touch this

let hosts = []
const robots = robotsParser(
  {
    userAgent: "Cheesgle-crawlie", // The default user agent to use when looking for allow/disallow rules, if this agent isn't listed in the active robots.txt, we use *.
    allowOnNeutral: false, // The value to use when the robots.txt rule's for allow and disallow are balanced on whether a link can be crawled.
  },
);

process.on("unhandledRejection",function(){})

var crawling = {}

function truncate(str, n){
  return (str.length > n) ? str.substr(0, n-1) + '...' : str;
};

function crawlXml(url) {
  const sitemapXMLParser = new SitemapXMLParser(url, {
    delay: 3000,
    limit: 5
  });
  sitemapXMLParser.fetch().then(result => {
      result.forEach(thing =>{
        if(thing.loc[0])queue(thing.loc[0])
      })
  }).catch(()=>{});
}
 
var c = new Crawler({
  maxConnections : maxConnections,
  "userAgent":"Cheesgle-crawlie",
  "options":{
    "userAgent":"Cheesgle-crawlie"
  },
    callback : function (error, res, done) {
        if(!error){
          if(res.statusCode!==200)return
          if(!res.$)return
            var $ = res.$;

            let title = "No title"
            let desc = "No description"
            let keywords = []

            try{
              title = truncate($("title").first().text().replace(/&nbsp;/g," "),60) || "No title"
              desc = truncate($("meta[name=description]").attr("content").replace(/&nbsp;/g," "),200)||"No description"
              keywords = $("meta[name=keywords]").attr("content").split(",").slice(0,20) || []
            }catch{}

            if(typeof title !== 'string') title = "No title"
            if(typeof desc !== 'string') desc = "No description"
            if(keywords == "") keywords = ["cheese"]

            let cheeseRating = 0
            cheeseRating+=((title.toLowerCase().match(/cheese/g) || []).length)*60;
            cheeseRating+=((desc.toLowerCase().match(/cheese/g) || []).length)*24;
            keywords.forEach(element => {
              cheeseRating+=((element.toLowerCase().match(/cheese/g) || []).length)*9;
            })

            if(cheeseRating < 10)return

            noCrawl=noCrawl.filter(function(item) {
                return item !== new URL(res.request.uri.href).href
            })

            db.sites = db.sites.filter(item => item.u !== new URL(res.request.uri.href).href);

            db.sites.push({
              "t":title,
              "dc":desc,
              "kw":keywords.join(", "),
              "u":new URL(res.request.uri.href).href
            })
            db.list[new URL(res.request.uri.href).href] = Date.now()

            links = $('a');
            $(links).each((i,link)=>{
              if(!$(link).attr("href"))return
              let href = $(link).attr("href")
              if(href!=="#" && !href.startsWith("/?") && !href.startsWith("?")){
                //if(href.startsWith("."))href=href.substring(1);
                if(!href.startsWith("http")){
                  href=new URL(res.request.uri.href+href).href
                }
                try{
                  queue(href)
                }catch(e){}
              }
            })
        }
        done();
    }
});
 
function canCrawl(h){
  return new Promise((resolve,reject)=>{

    if(hosts[new URL(h).host]){
      resolve(robots.canCrawlSync(h))
    }else{
      robots.useRobotsFor(`https://${new URL(h).host}`).then(function(){
        hosts.push(new URL(h).host)
        resolve(robots.canCrawlSync(h))
      }).catch(function(){
        reject()
      })
    }
  })
}

var canqueue = true
if(db.sites.length > siteCap){
  canqueue = false
}
setInterval(() => {
  //if(db.sites.length > 250000){
  if(db.sites.length > siteCap){
    canqueue = false
  }else{
    console.log(`${db.sites.length} stored, (${noCrawl.length} noCrawl)`)
  }
  fs.writeFileSync("./db.txt",jsonpack.pack(db))
}, 30000);

function queue(h,sub){
  return new Promise(async(resolve,reject)=>{

    if(h.substring(0, h.indexOf('#')) !== ''){h=h.substring(0, h.indexOf('#'))}

    h=h.replace("http://","https://")

    h=h.replace(/(https?:\/\/)|(\/)+/g, "$1$2");

    if(h.slice(-1) !== "/")h+='/'

    if(h.startsWith('https://www.youtube.com/watch?v=')&&h.includes("/new/")){reject('Youtube.com watch URL that has /new/ in it. That can lead to spam of /new/ URLs.');return}

    if(!sub){
      if(noCrawl.includes(new URL(h).href)){reject("noCrawl includes the URL, will queue if it's sumbitted by a user.");return}
    }
    noCrawl.push(new URL(h).href)

    if(!canqueue){reject("The limit of sites that can be added to this Cheesgle has been reached.");return}

    if(new URL(h).href.length > 150){reject("The URL is over 150 characters long.");return}

    //if(h.endsWith("index.html"))reject();return;if(h.endsWith("index.htm"))reject();return;

    if(db.list[new URL(h).href]){
      if((new Date() - new Date(db.list[new URL(h).href])) < 1800000) reject("That page was crawled in the past 30 minutes.");return
    }

    if(crawling[new URL(h).host]){

      if(reliableSites.includes(crawling[new URL(h).host])){
        if(crawling[new URL(h).host] > reliableLimitPer10Minutes){reject(`The host website (reliable) has had too many pages crawled in the last 10 minutes. The maximum for that host website is ${reliableLimitPer10Minutes} pages added per 10 minutes.`);return}
      }else{
        if(crawling[new URL(h).host] > nonReliableLimitPer10Minutes){reject(`The host website has had too many pages crawled in the last 10 minutes. The maximum for that host website is ${nonReliableLimitPer10Minutes} pages added per 10 minutes.`);return}
      }

      crawling[new URL(h).host]++
    }else{
      crawling[new URL(h).host] = 1
      setInterval(() => {
        crawling[new URL(h).host] = 0
      }, 600000);
    }

    if(blockUrlsThatInclude.some(v => h.includes(v))){
      reject(`blockUrlsThatInclude includes something that this URL has. The blockUrlsThatInclude list includes: ${blockUrlsThatInclude.join(", ")}`);return
    }

    canCrawl(h).then(function(can){
      if(can){
        console.log(`Crawling ${h}`)
        c.queue(h);
        resolve()
      }else{
        reject(`The robots.txt file of that website doesn't allow the us to crawl that page.`)
      }
    }).catch(()=>{reject(`Something went wrong.`)})
    
  })
}

/* Here you can manually queue sitemaps and websites upon runtime */

[].forEach(element=>{crawlXml(element)});

[].forEach(element=>{queue(element)}); // Replace the starting array (e.g ['https://site.one/','https://site.two/'])


/* Searching and refreshing collection */

var search = new Fuse(db.sites, {
  keys: ['t', 'dc','kw'],
  threshold:0.4
})
setInterval(() => {
  search.setCollection(db.sites)
}, 60000);

/* Web app logic, starting with requiring express and other middleware */

var bodyParser = require('body-parser')
const express = require('express');
const { time } = require('console');
const cors = require('cors');
const app = express()
const port = 3000

app.use(express.urlencoded({
  extended: true
}))

/* Index */

function protect(text) { // Replaces stuff with stuff
  return text.replace(/&/g, "&amp;").replace(/>/g, "&gt;").replace(/</g, "&lt;").replace(/"/g, "&quot;").replace(/&nbsp;/g," ");
}

function chunk (arr, len) { // Chunk function from stackoverflow

  var chunks = [],
      i = 0,
      n = arr.length;

  while (i < n) {
    chunks.push(arr.slice(i, i += len));
  }

  return chunks;
}

app.get('/api/:query/:page*?', cors(), (req, res) => {
  var { query, page } = req.params

  if(isNaN(Number(page))){
    page = 1
  }

  console.log(`Query: ${query}`)

  if(!query){res.status(400);res.end(JSON.stringify({
    "error":true,
    "reason":"Query needed",
    "code":"query"
  }));return}

  if(query.length > 500){
    res.status(400);res.end(JSON.stringify({
      "error":true,
      "reason":"Query too long",
      "code":"tooLong"
    }));return
  }

  const time1 = performance.now(); // Gets the current time in ms

  var resp = search.search(query) // Search with query
  const allResults = resp.length
  resp=chunk(resp,pageSize) // Chunk into pages
  const pages = resp.length

  if(page>pages || page<1){page=1};page=Math.round(page);

  resp=resp[page-1]

  const timeTook = Math.round(performance.now()-time1)

  if(resp == undefined){
    res.status(204)
    res.end(JSON.stringify({
      "error":true,
      "reason":"No results found",
      "code":"noResults"
    }))
    return
  }

  let results = resp.length

  let resultsJson = []

  for (let i = 0; i < results; i++) {
    resultsJson.push({
      "href":encodeURI(resp[i].item.u),
      "title":protect(resp[i].item.t),
      "description":protect(resp[i].item.dc)
    })
  }

  res.end(JSON.stringify({
    "error":false,
    "resultsCount":allResults,
    "timeInMs":timeTook,
    "results":resultsJson,
    "pages":pages,
    "page":page
  }))
})

app.use('/Search/search.html', function (req, res, next) {
  if(!req.query.q){
    res.redirect('/Search/search.html?q=what')
    return
  }
  next()
})

app.use('/submitSite', sumbitPageRateLimit)

app.post('/submitSite',bodyParser.json(),async(req,res)=>{
  if(req.body.url){
    if(req.body.url.startsWith("https://")){
      queue(req.body.url,true).then(()=>{
        res.end(queueSuccessfulMessage)
      }).catch((e)=>{
        res.end(`There was an error while trying to queue that page: ${e}`)
      })
    }else{
      res.end("We need the URL to start with https://")
    }
  }else{
    res.end("An URL is needed")
  }
})

app.get('/submitSiteInfo',cors(),(req,res)=>{
  res.end(`<h1><b>Page submission</b></h1><br>
Here you can submit a URL for us to crawl and add to our engine.<br>
Keep in mind, these conditions must be met for the page to be crawled.<br>
<ul>
  <li>The page must have the word "cheese" in it's title, description, or at least 2 occurances in the keywords.</li>
  <li>Host websites can only have ${nonReliableLimitPer10Minutes} of it's pages crawled every 10 minutes. For <a href="../Verified/about.html">verified</a> websites, the limit is ${reliableLimitPer10Minutes}.</li>
  <li>The URL cannot be over 150 characters in length.</li>
  <li>The page cannot be crawled in the past 30 minutes.</li>
  <li>The crawler can only have ${maxConnections} connections open at a time. See the <a href="https://www.npmjs.com/package/crawler">crawler package</a> for more info on that.</li>
</ul>
<br>
Ready to add a page to this useless search engine? Go ahead! The form is below.`)
})

app.get('/Verified/list.json',cors(),(req,res)=>{
  res.end(JSON.stringify(reliableSites))
})

app.get('/pageCount',(req,res)=>{
  if(canqueue){
    res.end(`Cheesgle is proudly tasting ${db.sites.length} pages.`)
  }else{
    res.end(`Cheesgle has capped out at ${db.sites.length} pages and no more can be added for the time being.`)
  }
})

app.use(express.static("./public"))

app.listen(port, () => {
  console.log(`Example app listening at http://localhost:${port}`)
})