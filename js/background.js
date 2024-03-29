const manifestData = chrome.runtime.getManifest();
const AppTitle = manifestData.name;
const AppVersion = manifestData.version;
const AppSmallTitle = "Companion";
const browser_action_default_title = manifestData.browser_action.default_title;


const base_LIVE_Url = "https://robertsspaceindustries.com/";
const base_LIVECDN_Url = "https://cdn.robertsspaceindustries.com/";
const base_PTU_Url = "https://ptu.cloudimperiumgames.com/";


// For cache, in sec
const cache_expiration_after_sec = 60*60*6; // 6 hours

function isDevMode() {
    return !('update_url' in chrome.runtime.getManifest());
}

var display_log = false;
if (isDevMode()) display_log = true;

function show_log(log)
{
	if (display_log) console.log(log);
}




var local_storage = {};

var FrienList = {live: [], ptu: []};
var AddedMembers = [];
var OrgList = [];
var Boards = [];
var BoardData = [];
var Telemetry = [];
var Manufacturers = [];
var News = {success: 1, code: "OK", msg: "OK", data: [], total: 0, last_read: false};
var OrgMembers = [];
var ShipList = {};
var BuyBack = {success: 0, code: "KO", msg: "KO", data: {}};

var application_tab = false;

var checking_connection = false;
var last_CheckConnection = 0;
var max_periodInMinutes = 10;

var caching_data = false;


var live_cnx = {
	connected: false,
	token: false,
	data: {}
};

var ptu_cnx = {
	connected: false,
	token: false,
	data: {}
};

var connection_status = {
	live: live_cnx,
	ptu: ptu_cnx,
};


chrome.runtime.setUninstallURL(base_LIVE_Url + 'community/citizen-spotlight/16217-RSI-Companion');

// When browser is started
chrome.runtime.onStartup.addListener(() => {
	setAlarm('CheckConnection', 1);
	
	// check if user is connected on RSI
	CheckConnection (false, (connection_status) => {
		show_log('CheckConnection DONE from onStartup');
		cache_data(connection_status, () => {
			show_log("Caching => [Ended]");
		});
	});
	
});

// Extension is installed / upgraded
chrome.runtime.onInstalled.addListener((details) => {
	
	// We clear all cache but BuyBack
	chrome.storage.local.get(['News', 'ShipList', 'BuyBack'], function (result){
		if (typeof result.News != "undefined") News = result.News;
		if (typeof result.ShipList != "undefined") ShipList = result.ShipList;
		if (typeof result.BuyBack != "undefined") BuyBack = result.BuyBack;
		
		// Clear local storage on new install / upgrade
		chrome.storage.local.clear(function (callback){
			local_storage = {};

			chrome.storage.local.set({News: News, ShipList: ShipList, BuyBack: BuyBack}, () => {
				local_storage.News = News;
				local_storage.ShipList = ShipList;
				local_storage.BuyBack = BuyBack;
			});
		});
	});

	// check if user is connected on RSI
	CheckConnection (false, (connection_status) => {
		show_log('CheckConnection DONE from onInstalled');
		
		cache_data(connection_status, () => {
			show_log("Caching => [Ended]");
			if (details.reason == "install")
			{
				show_log("This is a first install!");
				
				// Open the Application
				OpenApp();
			}
			else if (details.reason == "update")
			{
				var thisVersion = chrome.runtime.getManifest().version;
				
				if (thisVersion != details.previousVersion)
				{
					show_log("Updated from " + details.previousVersion + " to " + thisVersion + "!");
				}
			}
		});
		
	});
});


// Alarm for checking if user is connected and updating cache if needed.
chrome.alarms.onAlarm.addListener((alarm) => {	
	switch (alarm.name)
	{
		case "CheckConnection":
			show_log('------- TIMER -------');
			CheckConnection (false, (connection_status) => {
				show_log('CheckConnection DONE from onAlarm');
				
				// get last periodInMinutes and replace the current alarm.
				chrome.alarms.get(alarm.name, (this_alarm) => {
					
					periodInMinutes = this_alarm.periodInMinutes;

					if (periodInMinutes < max_periodInMinutes) periodInMinutes++;
					// replace the previous alarm.
					setAlarm(alarm.name, periodInMinutes);
					
					cache_data(connection_status, () => {
						show_log("Caching => [Ended]");
					});
				});
			});
			break;
		default:
			break;
	}
});


// When user click on the Application icon
chrome.browserAction.onClicked.addListener(function callback(tabs){	
	chrome.browserAction.getBadgeText ({tabId: tabs.id}, (BadgeText) => {
		var nb_notification = parseInt(BadgeText);
		if (isNaN(nb_notification)) nb_notification = 0;
		
		var new_url = "html/index.html" + (nb_notification > 0 ? '#page_Spectrum': '');
		
		if (application_tab !== false)
		{		
			// check if Application is already opened
			chrome.tabs.get( application_tab.id, function callback(tab){
				if (typeof tab == "undefined")
				{
					// Open the Application
					OpenApp(nb_notification);
				}
				else
				{
					// highlight tab
					if (tabs.windowId == application_tab.windowId)
					{
						if (!tab.highlighted) chrome.tabs.highlight({windowId: tab.windowId, tabs: tab.index});
						chrome.tabs.update(application_tab.id, {url: new_url});
					}
					else
					{
						// if we press the icon on a different browser window where the application is currently opened, let's move it to new window
						chrome.tabs.move(application_tab.id, {windowId: tabs.windowId, index: -1}, function callback(tab){
							application_tab.windowId = tab.windowId;
							if (!tab.highlighted) chrome.tabs.highlight({windowId: tab.windowId, tabs: tab.index});
							chrome.tabs.update(application_tab.id, {url: new_url});
						});
					}
				}
			});
		}
		else
		{
			// Open the Application
			OpenApp(nb_notification);
		}
		
	});
});


// When attaching a tab
chrome.tabs.onAttached.addListener(function callback(tabId, attachInfo){
	// Checking if attached tab is our application
	if (application_tab !== false && application_tab.id == tabId)
	{
		// if so, we update our application windowId
		application_tab.windowId = attachInfo.windowId;
	}
});


// When closing a tab
chrome.tabs.onRemoved.addListener(function callback(tabId, removeInfo){
	// Checking if closed tab is our application
	if (application_tab !== false && application_tab.id == tabId)
	{
		// if so, we remove our application info
		application_tab = false;
	}
});


// When focus on Application
chrome.tabs.onActivated.addListener(function callback(activeInfo){	
	if (typeof application_tab !== false && activeInfo.tabId == application_tab.id)
	{
		setAlarm('CheckConnection', 1);
					
		chrome.tabs.sendMessage(
			activeInfo.tabId, {
				type: "CheckConnection"
			}
		);
	}

});


// Open the Application
function OpenApp(nb_notification) {
	setAlarm('CheckConnection', 1);
	
	var open = function(){
		if (checking_connection === false && caching_data === false){
			// run when condition is met
			chrome.tabs.create({
				url: "html/index.html" + (nb_notification > 0 ? '#page_Spectrum': ''),
				active: true
			}, (tab) => {
				application_tab = tab;
			});
		}
		else {
			setBadge('WAIT', '#BF6913');
			setTimeout(open, 250); // check again in 250 second
		}
	}

	open();
}


// Get data from storage
chrome.storage.local.get(function (result){
	local_storage = result;
});


// Function for creating an alarm "alarm_name" occuring every "periodInMinutes"
function setAlarm(alarm_name, periodInMinutes)
{
	//show_log(alarm_name + " will be triggered in the next " + periodInMinutes + " min");
	chrome.alarms.create(alarm_name, { periodInMinutes: periodInMinutes });
}





function setBadge (text, bg_color = false) {
	
	if (bg_color !== false) chrome.browserAction.setBadgeBackgroundColor({color: bg_color});
	else chrome.browserAction.setBadgeBackgroundColor({color: '#28a745'});
	
	chrome.browserAction.setBadgeText ( { text: "" + text + "" } );
}

function getBadgeNumber () {
	
	if (application_tab !== false)
	{
		chrome.browserAction.getBadgeText ({tabId: application_tab.id}, (BadgeText) => {
			BadgeNumber = parseInt(BadgeText);
			if (isNaN(BadgeNumber)) BadgeNumber = 0;
			
			return BadgeNumber;
		});
	}
	else return 0;
}



function cache_data(connection_status, callback)
{
	show_log("Caching => [Started]");
	
	if (connection_status.live.connected === true && caching_data === false)
	{
		// User is connected	

		caching_data = true;
		
		current_timestamp = Math.floor(Date.now() / 1000);
		
		// Add ShipList into cache
		if (OrgList.length == 0 || (current_timestamp - OrgList.cached_since) > cache_expiration_after_sec)
		{

			// Add OrgList into cache
			show_log("Caching Organizations");
			getOrganizations ((data) => {
				data.cached_since = current_timestamp;
				OrgList = data;
				
				caching_data = false;
				callback();
			})
		}
		else
		{
			caching_data = false;
			callback();
		}
	}
	else
	{
		caching_data = false;
		callback();
	}
}


function Identify (LIVE, Token, callback)
{
	if (Token.length == 0)
	{
		callback({success: 0, code: "KO", msg: "KO"});
	}
	else
	{
		if (LIVE)
		{
			this_base_Url = base_LIVE_Url;
			this_headers = { "x-rsi-token": Token, "x-tavern-id": Token };
		}
		else
		{
			this_base_Url = base_PTU_Url;
			this_headers = { "x-rsi-ptu-token": Token, "x-tavern-id": Token };
		}
		
		$.ajax({
			async: true,
			type: "post",
			contentType: 'application/json',
			url: this_base_Url + "api/spectrum/auth/identify",
			success: (result) => {				
				if (result.success == 1 && result.data.member != null)
				{
					var data = result.data;
					
					connection_status.live.data.friend_requests = data.friend_requests;
					connection_status.live.data.friends = data.friends;
				}
				
				callback (result);
			},
			error: (request, status, error) => {
				callback({success: 0, code: "KO", msg: request.responseText});
			},
			data: JSON.stringify({}),
			headers: this_headers
		});
	}
}

function CheckConnection (force, callback)
{
	const now = Date.now();
	
	show_log("CheckConnection");
	
	// CheckConnection can't be done more than one time every 60 sec. Unless we "force" it.
	if ( (( now - last_CheckConnection) > (60 * 1000) || force) && checking_connection === false) 
	{
		show_log("CheckConnection => [Started]");
		checking_connection = true;
		last_CheckConnection = now;
		
		live_cnx = {
			connected: false,
			token: false,
			data: {}
		};

		ptu_cnx = {
			connected: false,
			token: false,
			data: {}
		};
		
		
		getServiceStatus( (status) => {
			
			//////////////////////////
			// check LIVE CONNEXION //
			//////////////////////////	
			
			// Try to get current cookie on LIVE RSI website
			chrome.cookies.get({
				"url": base_LIVE_Url,
				"name": "Rsi-Token"
			}, (cookie) => {
				if (cookie == null) cookie = '';
				else cookie = cookie.value;
				
				Identify (true, cookie , (result) => {
					connection_status.live = live_cnx;
					
					if (result.success == 1 && result.data.member != null)
					{
						cnx = live_cnx;
						if (!cnx.connected)
						{
							//user wasn't connected before
							Vote (cookie, 'rlbaq1igbjnqg', false, (data) => {});
							
						}
						
						cnx.connected = true;
						cnx.token = cookie;
						
						var data = result.data;
						data.service_status = status;
						data.nb_Spectrum_notification = 0;
						GetNotifications(data);
						cnx.data = data;
						
						connection_status.live = cnx;

						chrome.browserAction.setTitle({title: browser_action_default_title}, () => {
						});
					}
					else
					{
						chrome.browserAction.setTitle({title: 'Disconnected. Click to log in.'}, () => {
						});
						setBadge(" ", "#FF6453");
					}
					
					/////////////////////////
					// check PTU CONNEXION //
					/////////////////////////
					chrome.cookies.get({
						"url": base_PTU_Url,
						"name": "Rsi-PTU-Token"
					}, (cookie) => {

						if (cookie == null) cookie = '';
						else cookie = cookie.value;

						Identify (false, cookie, (result) => {
							connection_status.ptu = ptu_cnx;

							if (result.success == 1 && result.data.token != null)
							{
								cnx = ptu_cnx;
								cnx.connected = true;
								cnx.token = cookie;
								cnx.data = result.data;
								
								connection_status.ptu = cnx;
							}
							
							show_log("CheckConnection => [Ended]");
							
							checking_connection = false;
							callback(connection_status);
						});
					});
				});
			});
		});
		
		
	}
	else
	{
		checking_connection = false;
		// we return cache
		callback(connection_status);
	}
}



function GetNotifications(data)
{
	///////////////////////////////////////////////////////
	/////////////// UPDATE NOTIFICATION ///////////////////
	///////////////////////////////////////////////////////
	my_user_id = data.member.id
	
	data.nb_private_lobbies_unread = 0;
	data.nb_NewTopics = 0;
	data.nb_friend_request = 0;
	
	var done = 0;
	
	$(data.private_lobbies).each((index, value) => {
		last_sender_id = value.last_message.member_id;
		
		if (value.new_messages && last_sender_id != my_user_id)
		{
			data.nb_private_lobbies_unread++;
			
			sender = false;
			
			$(value.members).each((i, member) => {
				if (member.id == last_sender_id) sender = member;
			});
			
			if (sender !== false)
			{
				data.notifications.push({
					id: "private-" + value.id + "-new-message",
					type: "private-new-message",
					grouped: false,
					time: value.last_message.time_modified,
					thumbnail: sender.avatar,
					text_tokens: {
						displayname: sender.displayname,
						plaintext: value.last_message.plaintext,
					},
					link_tokens: {
						link_path: "private", member_id: sender.id
					},
					subscription: {
					},
					unread: value.new_messages
				});
			}	
		}
	});

	$(data.friend_requests).each((index, value) => {
		
		if (value.requesting_member_id != my_user_id)
		{
			data.nb_friend_request++;
			
			sender = false;
			
			$(value.members).each((i, member) => {
				if (member.id != my_user_id) sender = member;
			});
			
			if (sender !== false)
			{
				data.notifications.push({
					id: "friend-" + value.id + "-new-request",
					type: "friend-new-request",
					grouped: false,
					time: value.time_modified,
					thumbnail: sender.avatar,
					text_tokens: {
						displayname: sender.displayname,
						plaintext: value.status,
					},
					link_tokens: {
						link_path: "friend"
					},
					subscription: {
					},
					unread: true
				});
			}	
		}
	});
	
	
	var community = data.communities.find(elem => elem.id == 1);
	var channel_groups = community.forum_channel_groups;

	var all_forums = [];
	var all_threads = [];
		
	if (typeof channel_groups != "undefined")
	{
		// Official => 2, StarCitizen => 2, PTU => 63927
		var forums = [1, 3, 190048];
		
		$(forums).each((index, forum) => {
			for (const key in channel_groups) {
				$(channel_groups[key].channels).each((index, channel) => {
					if (channel.id == forum) {
					all_forums.push(channel);
					}
				});
			}
		});

		$(all_forums).each((index, channel) => {
			getSpectrumThreads (cnx.token, channel.id, (result) => {
				if (result.success == 1)
				{
					$(result.data.threads).each( (i, thread) => {
						if (thread.highlight_role_id == "2")
						{
							thread.community = community;
							thread.channel = channel;
							all_threads.push(thread)
						}
					});
				}
				
				done ++;
				
				if (done == all_forums.length) {
					$(all_threads).each((index, thread) => {
						if (thread.is_new) data.nb_NewTopics++;
					});
					
					data.nb_Spectrum_notification = parseInt(data.notifications_unread) + data.nb_private_lobbies_unread + data.nb_friend_request;
					
					data.total_notification = data.nb_Spectrum_notification + data.nb_NewTopics;
	
					if (data.total_notification > 0) setBadge(data.total_notification);
					else setBadge("0");

					if (application_tab !== false)
					{
						chrome.tabs.sendMessage(
							application_tab.id, {
								type: "UpdateSpectrumNotifications",
								data: data,
							}
						);
					}
				}
			});
		});
	}
}


// Mark a topic as read in Spectrum
function SpectrumThreadNested (LIVE_Token, slug, callback)
{
	$.ajax({
		async: true,
		type: "post",
		contentType: 'application/json',
		url: base_LIVE_Url + "api/spectrum/forum/thread/nested",
		success: (result) => {
			callback(result);
		},
		error: (request, status, error) => {
			callback({success: 0, code: "KO", msg: request.responseText});
		},
		data: JSON.stringify({
			slug: slug,
			sort: "newest",
			target_reply_id: null
		}),
		headers: {
			"x-rsi-token": LIVE_Token,
			"x-tavern-id": LIVE_Token
		}
	});
}


// Get Spectrum threads
function getSpectrumThreads (LIVE_Token, channel_id, callback)
{
	$.ajax({
		async: true,
		type: "post",
		contentType: 'application/json',
		url: base_LIVE_Url + "api/spectrum/forum/channel/threads",
		success: (result) => {
			callback(result);
		},
		error: (request, status, error) => {
			callback({success: 0, code: "KO", msg: request.responseText});
		},
		data: JSON.stringify({
			"channel_id": channel_id,
			"page": 1,
			"sort": "newest",
			"label_id": null
		}),
		headers: {
			"x-rsi-token": LIVE_Token,
			"x-tavern-id": LIVE_Token
		}
	});
}

// Mark a Spectrum notification as read
function SpectrumRead (LIVE_Token, notification_id, callback)
{
	$.ajax({
		async: true,
		type: "post",
		contentType: 'application/json',
		url: base_LIVE_Url + "api/spectrum/notification/read",
		success: (result) => {
			callback(result);
		},
		error: (request, status, error) => {
			callback({success: 0, code: "KO", msg: request.responseText});
		},
		data: JSON.stringify({
			notification_id: notification_id
		}),
		headers: {
			"x-rsi-token": LIVE_Token,
			"x-tavern-id": LIVE_Token
		}
	});
}

// Mark all Spectrum notification
function SpectrumReadAllNotifications (LIVE_Token, callback)
{
	$.ajax({
		async: true,
		type: "post",
		contentType: 'application/json',
		url: base_LIVE_Url + "api/spectrum/notification/read-all",
		success: (result) => {
			callback(result);
		},
		error: (request, status, error) => {
			callback({success: 0, code: "KO", msg: request.responseText});
		},
		data: JSON.stringify({}),
		headers: {
			"x-rsi-token": LIVE_Token,
			"x-tavern-id": LIVE_Token
		}
	});
}

// Get Crowdfunding statistics (Number of backers & Money collected)
function getCrowdfundStats (callback)
{
	$.ajax({
		async: true,
		type: "post",
		contentType: 'application/json',
		url: base_LIVE_Url + "api/stats/getCrowdfundStats",
		success: (result) => {
			callback(result);
		},
		error: (request, status, error) => {
			callback({success: 0, code: "KO", msg: request.responseText});
		},
		data: JSON.stringify({
			"chart": "day",
			"fans": true,
			"funds": true,
			"alpha_slots": false,
			"fleet": false
		}),
		headers: {
			
		}
	});
}


// Get Full Ship list from RSI website + owned ships + loan ships.
function getShipList(LIVE_Token, callback)
{
	$.ajax({
		async: true,
		type: "post",
		contentType: 'application/json',
		url: base_LIVE_Url + "ship-matrix/index",
		success: (ship_matrix_result) => {
			var ship_matrix = ship_matrix_result.data;
			var ship_matrix_id = [];
			var MyShipLoaned = [];
			var MyShipLoanedInversed = [];
			var owned_ship = [];
			var Manufacturers = [];
			var my_ships_to_be_checked = [];
			var my_ships_not_found = [];
			if (typeof local_storage.report == "undefined") local_storage.report = {};
			
			ship_matrix.push({
				'id': 1000,
				'name': 'Dragonfly Star Kitten Edition',
				'production_status': 'flight-ready',
				'type': 'competition',
				'focus': 'Racing',
				'url': '/referral-contest#star-kitten',
				'media': {
					0: {
						'images':{
							'slideshow': 'https://i.imgur.com/cfhyazG.jpg',
						}
					}
				},
				'manufacturer':{
					'id': 5,
					'name': 'Drake Interplanetary',
					'code': 'DRAK',
				},
			});
			
			ship_matrix.push({
				'id': 1001,
				'name': 'F8C Lightning Civilian',
				'production_status': 'in-concept',
				'type': 'combat',
				'focus': 'Heavy Fighter',
				'url': '/galactapedia/article/0Gz5LW2ekd-f8c-lightning',
				'media': {
					0: {
						'images':{
							'slideshow': 'https://i.imgur.com/YoEgAs1.png',
						}
					}
				},
				'manufacturer':{
					'id': 3,
					'name': 'Anvil Aerospace',
					'code': 'ANVL',
				},
			});
			
			ship_matrix.push({
				'id': 1002,
				'name': 'F8C Lightning Executive Edition',
				'production_status': 'in-concept',
				'type': 'combat',
				'focus': 'Heavy Fighter',
				'url': '/galactapedia/article/0Gz5LW2ekd-f8c-lightning',
				'media': {
					0: {
						'images':{
							'slideshow': 'https://i.imgur.com/LmmtsYq.jpg',
						}
					}
				},
				'manufacturer':{
					'id': 3,
					'name': 'Anvil Aerospace',
					'code': 'ANVL',
				},
			});
			
			ship_matrix.push({
				'id': 1003,
				'name': 'PTV',
				'production_status': 'flight-ready',
				'type': 'transport',
				'focus': '',
				'url': '/pledge/Standalone-Ships/PTV-Buggy',
				'media': {
					0: {
						'images':{
							'slideshow': 'https://i.imgur.com/8cfQ32V.jpg',
						}
					}
				},
				'manufacturer':{
					'id': 17,
					'name': 'Greycat Industrial',
					'code': 'GRIN',
				},
			});
			
			if (ship_matrix_result.success == 1 && ship_matrix_result.data.length > 0)
			{
				for (let [index, ship] of Object.entries(ship_matrix)) {
					sorted_name = ship.manufacturer.name.toLowerCase() + ' - ' + ship.name.toLowerCase();
					ship.sorted_name = sorted_name;
					ship.owned = false;
					ship.nb = 0;
					ship.loaner = false;
					ship.name = ship.name.trim();	
					ship_matrix_id[ship.id] = ship;
					
					if (!Manufacturers.find(x => x.id == ship.manufacturer.id)) Manufacturers.push({name: ship.manufacturer.name, code: ship.manufacturer.code});
				}
				
				
				// return loaned matrix
				$.ajax({
					async: true,
					type: "get",
					contentType: 'application/json',
					url: "https://rsi-companion.kamille.ovh/getShipNameInfo",
					cache : true,
					success: (result) => {
						if (result.success == 1) ShipNameInfo = result.data;
						else ShipNameInfo = {};
						
						// return loaned matrix
						$.ajax({
							async: true,
							type: "get",
							contentType: 'application/json',
							url: "https://rsi-companion.kamille.ovh/getLoaners",
							cache : true,
							success: (result) => {
								if (result.success == 1) Loaners = result.data;
								else Loaners = {};
								
								// return Ship list from My Hangar
								getHangar(LIVE_Token, 1, (result) => {
									if (result.success == 1) HangarShips = result.data;
									else HangarShips = [];
									
									if (HangarShips.length > 0)
									{
										// Comes now, let's try to fix all ships name...
										
										var separator = '######'
										my_ships = HangarShips.join(separator);
										
										$(Manufacturers).each((code, value) => {
											my_ships = my_ships.replace(value.code, '');
											my_ships = my_ships.replace(value.code.toLowerCase(), '');
											my_ships = my_ships.replace(value.code.toUpperCase(), '');
											my_ships = my_ships.replace(value.name, '');
											my_ships = my_ships.replace(value.name.toLowerCase(), '');
											my_ships = my_ships.replace(value.name.toUpperCase(), '');
											
											names = value.name.split(' ');
											if (names.length > 0)
											{
												$(names).each((index, split_name) => {
													my_ships = my_ships.replace(split_name, '');
													my_ships = my_ships.replace(split_name.toLowerCase(), '');
													my_ships = my_ships.replace(split_name.toUpperCase(), '');
												});
											}
										});
										
										my_ships = my_ships.split(separator);
										
										var ship_found;
										$(my_ships).each((index, my_ship) => {
											my_ship = my_ship.trim();
											if (my_ship.length > 0)
											{
												ship_found = false;
												for (let [index, ship] of Object.entries(ship_matrix_id)) {
													if (!ship_found && ship.name == my_ship)
													{
														ship_found = true;
														//show_log('FOUND ' + ship_matrix_id[index].name);
														ship_matrix_id[index].owned = true;
														ship_matrix_id[index].nb = ship_matrix_id[index].nb + 1;
													}
												}
												if (!ship_found)
												{
													my_ships_to_be_checked.push(my_ship);
												}
											}
											
										});
										
										if (my_ships_to_be_checked)
										{
											$(my_ships_to_be_checked).each((index, my_ship_to_be_checked) => {
												ship_found = false;
												for (let [index, ship_info] of Object.entries(ShipNameInfo)) {
													if (!ship_found && ship_info.name == my_ship_to_be_checked)
													{
														for (let [index, ship_id] of Object.entries(ship_info.ids)) {
															for (let [index, ship] of Object.entries(ship_matrix_id)) {
																if (!ship_found && ship.id == ship_id)
																{
																	ship_found = true;
																	//show_log('FOUND ENTRY ONLINE FOR ' + my_ship_to_be_checked + ' with ' + ship_matrix_id[index].name);
																	ship_matrix_id[index].owned = true;
																	ship_matrix_id[index].nb = ship_matrix_id[index].nb + 1;
																}
															}
														}
													}
												}
												if (!ship_found)
												{
													my_ships_not_found.push(my_ship_to_be_checked);
												}
											});
										}										
									}
									
									result.data = {ships: ship_matrix, loaners: MyShipLoaned, loaners_inversed: MyShipLoanedInversed, ships_not_found: my_ships_not_found, report: local_storage.report, dev: display_log};
									
									for (let [index, ship] of Object.entries(ship_matrix_id)) {
										if (ship.owned) {
											if (typeof Loaners[ship.id] !== "undefined") {
												$(Loaners[ship.id]).each(function (index, value) {
													if (typeof ship_matrix_id[value] !== "undefined")
													{
														if (MyShipLoaned.includes(value) === false)
														{
															MyShipLoaned.push(value);
														}
														if (typeof MyShipLoanedInversed[value] == "undefined") MyShipLoanedInversed[value] = [];
														MyShipLoanedInversed[value].push(ship.id);
														
														//show_log('SHIPID => ' + ship.id + ' != VALUE => ' + value);
														if (ship_matrix_id[value].owned === false) ship_matrix_id[value].loaner = true;
														else ship_matrix_id[value].loaner = false;
													}
												});
											} else {
												if (MyShipLoaned.includes(ship.id) === false)
												{
													MyShipLoaned.push(ship.id);
												}
											}
										}
									}
									
									ship_matrix = [];
									for (let [index, ship] of Object.entries(ship_matrix_id)) {
										ship_matrix.push(ship);
									}
									
									callback(result);
								});
							},
							error: (request, status, error) => {
								callback({success: 0, code: "KO", msg: request.responseText});
							}
						});
					},
					error: (request, status, error) => {
						callback({success: 0, code: "KO", msg: request.responseText});
					}
				});
			}
			else callback({success: 1, code: "OK", msg: "OK", data: {ships: {}}});
		},
		error: (request, status, error) => {
			callback({success: 0, code: "KO", msg: request.responseText});
		},
		data: JSON.stringify({}),
		headers: { "x-rsi-token": LIVE_Token },
		data: "{}"
	});
}

var Hangar;
function getHangar(LIVE_Token, page, callback)
{	
	if (page == 1) Hangar = [];
	
	$.ajax({
		async: true,
		type: "get",
		url: base_LIVE_Url + "account/pledges",
		success: (result) => {
			var html = $.parseHTML( result );
			
			last_button_href = $(html).find('a.raquo.btn:eq(0)').attr('href');
			if (typeof last_button_href != "undefined") max_page = last_button_href.replace('/account/pledges?page=', '').replace('&pagesize=10', '');
			else max_page = 0;
			
			var Ship = $(html).find('ul.list-items li .kind:contains(\'Ship\')');
			Ship.parent().find('.title').each((index, value) => {
				ship_name = $(value).text().trim();
				Hangar.push(ship_name);
			});
			
			// FOR GREYCAT PTV
			var GRIN = $(html).find('ul.list-items li .liner > span:contains(\'GRIN\')');
			GRIN.parent().parent().find('.title').each((index, value) => {
				ship_name = $(value).text().trim();
				Hangar.push(ship_name);
			});
			
			if (page < max_page)
			{
				getHangar(LIVE_Token, page + 1, callback);
			}
			else callback({success: 1, code: "OK", msg: "OK", data: Hangar});
		},
		error: (request, status, error) => {
			callback({success: 0, code: "KO", msg: request.responseText});
		},
		data: {
			page: page
		},
		headers: { "x-rsi-token": LIVE_Token }
	});
}


// Return telemetry data
function getTelemetry(LIVE_Token, callback)
{
	$.ajax({
		async: true,
		type: "post",
		contentType: 'application/json',
		url: base_LIVE_Url + "api/telemetry/v2/playeridx/",
		success: (result) => {
			callback(result);
		},
		error: (request, status, error) => {
			callback({success: 0, code: "KO", msg: request.responseText});
		},
		data: JSON.stringify({}),
		headers: { "x-rsi-token": LIVE_Token }
	});
}


// Return list of Roadmaps
function getBoards(callback)
{
	$.ajax({
		async: true,
		type: "get",
		contentType: 'application/json',
		url: base_LIVE_Url + "api/roadmap/v1/init",
		success: (result) => {
			callback(result);
		},
		error: (request, status, error) => {
			callback({success: 0, code: "KO", msg: request.responseText});
		},
	});
}


var session_data = [];

// Return Roadmap data for a specific BoardID. 1: SC & 2: SQ42
function getBoardData(BoardID, BoardLastUpdated, callback)
{
	if (typeof session_data[BoardID] == "undefined") session_data[BoardID] = [];
	
	if (typeof session_data[BoardID][BoardLastUpdated] != "undefined") callback(session_data[BoardID][BoardLastUpdated]);
	else
	{		
		$.ajax({
			async: true,
			type: "post",
			contentType: 'application/json',
			url: "https://rsi-companion.kamille.ovh/getBoardData",
			success: (BoardData) => {
				if (BoardData.success == 1) session_data[BoardID][BoardLastUpdated] = BoardData;
				
				callback(BoardData);
			},
			data: JSON.stringify({
				id: BoardID,
				last_updated: BoardLastUpdated,
			}),
			error: (request, status, error) => {
				callback({success: 1, code: "OK", msg: "OK", data: {}});
			}
		});
	}
}

//Search in Contact list
function SearchContact(LIVE, token, Query, callback)
{
	
	if (LIVE)
	{
		this_base_Url = base_LIVE_Url;
		this_headers = { "x-rsi-token": token, "x-tavern-id": token };
	}
	else
	{
		this_base_Url = base_PTU_Url;
		this_headers = { "x-rsi-ptu-token": token, "x-tavern-id": token };
	}
	
	$.ajax({
		async: true,
		type: "post",
		contentType: 'application/json',
		url: this_base_Url + "api/spectrum/search/member/autocomplete",
		success: (result) => {
			callback(result);
		},
		error: (request, status, error) => {
			callback({success: 0, code: "KO", msg: request.responseText});
		},
		data: JSON.stringify({
			community_id: null,
			ignore_self: true,
			text: Query,
		}),
		headers: this_headers
	});
}



var friend_list = [];
//Get Friend List on LIVE OR PTU instance

function getFriends (LIVE, token, callback) {
	Identify(true, token, (data) => {
		$(live_cnx.data.friends).each(function (i, value) {
			live_cnx.data.friends[i].following = true;
		});
		
		if (LIVE) callback({success: 1, code: "OK", msg: "OK", data: live_cnx.data.friends});
		else callback({success: 1, code: "OK", msg: "OK", data: ptu_cnx.data.friends});
	});
}

function getFriendRequests (LIVE, token, callback) {
	if (LIVE) callback({success: 1, code: "OK", msg: "OK", data: live_cnx.data.friend_requests});
	else callback({success: 1, code: "OK", msg: "OK", data: ptu_cnx.data.friend_requests});
}

/*
function getFriends (LIVE, token, callback) {
	if (LIVE)
	{
		this_base_Url = base_LIVE_Url;
		this_headers = { "x-rsi-token": token, "x-tavern-id": token };
	}
	else
	{
		this_base_Url = base_PTU_Url;
		this_headers = { "x-rsi-ptu-token": token, "x-tavern-id": token };
	}
	
	$.ajax({
		async: true,
		type: "post",
		contentType: 'application/json',
		url: this_base_Url + "api/spectrum/friend/list",
		success: (result) => {
			callback({success: 1, code: "OK", msg: "OK", data: result.data.members});
		},
		error: (request, status, error) => {
			callback({success: 0, code: "KO", msg: request.responseText});
		},
		data: JSON.stringify({
			page: '1',
			pagesize: '50',
			sort: 'displayname',
			sort_descending: 0,
			table: ''
		}),
		headers: this_headers
	});
}

function getFriendRequests (LIVE, token, callback) {
	if (LIVE)
	{
		this_base_Url = base_LIVE_Url;
		this_headers = { "x-rsi-token": token, "x-tavern-id": token };
	}
	else
	{
		this_base_Url = base_PTU_Url;
		this_headers = { "x-rsi-ptu-token": token, "x-tavern-id": token };
	}
	
	$.ajax({
		async: true,
		type: "post",
		contentType: 'application/json',
		url: this_base_Url + "api/spectrum/friend-request/list",
		success: (result) => {
			callback({success: 1, code: "OK", msg: "OK", data: result.data});
		},
		error: (request, status, error) => {
			callback({success: 0, code: "KO", msg: request.responseText});
		},
		data: JSON.stringify({
			page: '1',
			pagesize: '250',
			sort: 'displayname',
			sort_descending: 0,
			table: ''
		}),
		headers: this_headers
	});
}
*/

function CancelFriendRequest(LIVE_Token, request_id, callback)
{
	$.ajax({
		async: true,
		type: "post",
		contentType: 'application/json',
		url: base_LIVE_Url + "api/spectrum/friend-request/cancel",
		success: (result) => {
			callback(result);
		},
		error: (request, status, error) => {
			callback({success: 0, code: "KO", msg: request.responseText});
		},
		data: JSON.stringify({
			request_id : request_id
		}),
		headers: { "x-rsi-token": LIVE_Token, "x-tavern-id": LIVE_Token }
	});
}

function AcceptFriendRequest(LIVE_Token, request_id, callback)
{
	$.ajax({
		async: true,
		type: "post",
		contentType: 'application/json',
		url: base_LIVE_Url + "api/spectrum/friend-request/accept",
		success: (result) => {
			callback(result);
		},
		error: (request, status, error) => {
			callback({success: 0, code: "KO", msg: request.responseText});
		},
		data: JSON.stringify({
			request_id : request_id
		}),
		headers: { "x-rsi-token": LIVE_Token, "x-tavern-id": LIVE_Token }
	});
}

function DeclineFriendRequest(LIVE_Token, request_id, callback)
{
	$.ajax({
		async: true,
		type: "post",
		contentType: 'application/json',
		url: base_LIVE_Url + "api/spectrum/friend-request/decline",
		success: (result) => {
			callback(result);
		},
		error: (request, status, error) => {
			callback({success: 0, code: "KO", msg: request.responseText});
		},
		data: JSON.stringify({
			request_id : request_id
		}),
		headers: { "x-rsi-token": LIVE_Token, "x-tavern-id": LIVE_Token }
	});
}


/*
function getFriends (LIVE, token, page, cursor, callback) {
	page = page || 1;
	cursor = cursor || "";
	
	// because friend list could change, we reset cache for OrgMembers (for the Follow)
	OrgMembers = [];


	if (LIVE)
	{
		this_base_Url = base_LIVE_Url;
		this_headers = { "x-rsi-token": token };
	}
	else
	{
		this_base_Url = base_PTU_Url;
		this_headers = { "x-rsi-ptu-token": token };
	}

	if (page == 1) friend_list = [];

	$.ajax({
		async: true,
		type: "post",
		contentType: 'application/json',
		url: this_base_Url + "api/contacts/list",
		success: (result) => {

			// There are some friends left
			if (result.success == 1 && result.data.totalrows > 0) {
				cursor = result.data.cursor;

				$(result.data.resultset).each(function (i, value) {
					if (value.nickname.length )
					{
						friend_list.push(value);
					}
				});

				// load next page
				getFriends(LIVE, token, page + 1, cursor, callback);
			}
			else
			{
				// no more friend. We return the result
				callback({success: 1, code: "OK", msg: "OK", data: friend_list});
			}
		},
		error: (request, status, error) => {
			callback({success: 0, code: "KO", msg: request.responseText});
		},
		data: JSON.stringify({
			page: page,
			cursor: cursor
		}),
		headers: this_headers
	});
};
*/

// Add a nickname to Friendlist on LIVE or PTU account
function addtoFriendList (LIVE, token, member_id, add, callback) {

	if (LIVE)
	{
		this_base_Url = base_LIVE_Url;
		this_headers = { "x-rsi-token": token, "x-tavern-id": token };
	}
	else
	{
		this_base_Url = base_PTU_Url;
		this_headers = { "x-rsi-ptu-token": token, "x-tavern-id": token };
	}

	$.ajax({
		async: true,
		type: "post",
		contentType: 'application/json',
		url: this_base_Url + "api/spectrum/" + (add ? "friend-request/create" : "friend/remove"),
		success: (result) => {
			callback(result);
		},
		error: (request, status, error) => {
			callback({success: 0, code: "KO", msg: request.responseText});
		},
		data: JSON.stringify({
			member_id: member_id
		}),
		headers: this_headers
	});
};


// Return Organizations list

function getOrganizations(callback) {
	var organizations = [];
	
	(async () => {
		$.ajax({
			async: true,
			url: base_LIVE_Url + "account/organization",
			type: 'get',
			success: ( result, textStatus, jQxhr) => {
				var html = $.parseHTML( result );
				$(html).find('div.org-card').each(function( index ) {
					var name = $(this).find('div.info p.entry:nth-child(1) a').text();
					var SID = $(this).find('div.info div.front p.entry:nth-child(1) strong.value').text();
					var rank = $(this).find('div.info div.front p.entry:nth-child(2) strong.value').text();;
					
					var logo = $(this).find('div.thumb > a > img').attr('src');
					var level_number = $(this).find('div.ranking > span.active').length;
					
					var nb_member = parseInt($(this).find('div.thumb > span').text());
					
					var organization = {
						SID : SID,
						name : name,
						logo : logo,
						level_number : level_number,
						rank : rank,
						nb_member : nb_member,
					}
					
					organizations.push(organization);
				});

				callback({success: 1, code: "OK", msg: "OK", organizations: organizations});
			},
			error: (request, status, error) => {
				callback({success: 0, code: "KO", msg: request.responseText});
			},
		});
	})();
	return true; // keep the messaging channel open for sendResponse
}



var Org_Members = [];
// return Organizations members from Organization unique SID 
function getOrgMembers (Rsi_LIVE_Token, SID, user_handle, page, callback)
{
	page = page || 1;
	
	if (page == 1) Org_Members = [];	
	
	$.ajax({ // request a page of members
		async: true,
		type: "post",
		url: base_LIVE_Url + "api/orgs/getOrgMembers",
		success: (result) => {
			// There are some members left
			if (result.success == 1 && result.data && result.data.html) {
				
				//var html = $('<div></div>').html(result.data.html);
				var html = $.parseHTML( '<html><head></head><body><div>' + result.data.html.trim() + '</div></body></html>' );
				
				// looking for all members in that html
				$(html).find('li.member-item.org-visibility-V').each(function (i, value) {
					
					nickname = $(value).find('.nick').text();
					
					// check if member is not obfuscated
					if (nickname.length > 0 )
					{
						avatar = $(value).find('span.thumb > img').attr('src');
						name = $(value).find('.name').text();
						level_number = parseInt($(value).find('.stars').attr('style').replace( /^\D+/g, ''))/20;
						rank =$(value).find('.rank').text();
						
						var member = {
							avatar: avatar,
							displayname: name,
							nickname: nickname,
							level_number: level_number,
							rank: rank,
						}
						
						friend_list = FrienList.live.data;
						
						if (!friend_list.some(e => e.nickname === nickname) && nickname !== user_handle) member.following = false;
						else member.following = true;

						Org_Members.push(member);
					}
				});

				// load next page
				getOrgMembers(Rsi_LIVE_Token, SID, user_handle, page + 1, callback);
			}
			else
			{
				// no more friend. We return the result
				callback({success: 1, code: "OK", msg: "OK", data: Org_Members});
			}
		},
		error: (request, status, error) => {
			callback({success: 0, code: "KO", msg: request.responseText});
		},
		data: {"symbol": SID.toUpperCase(), "search": "", "pagesize": 32, "page": page},
		headers: { "x-rsi-token": Rsi_LIVE_Token }
	});
}



// Add to your friend list ALL members from Organization unique SID
function addOrganizationMembers (Rsi_LIVE_Token, SID, user_handle, add, page, callback) {
	AddedMembers = [];
	
	getOrgMembers (Rsi_LIVE_Token, SID, user_handle, page, (members) => {
		$(members.data).each( (index, member) => {
			// not already in your friendlist and not you
			if (!member.following)
			{
				AddedMembers.push(member);
				SearchContact(true, Rsi_LIVE_Token, member.nickname, (result) => {
					var friend_found = false;
					$(result.data.members).each(function (i, searched_member) {
						if (searched_member.nickname == member.nickname)
						{
							friend_found = searched_member;
						}
					});
					
					if (friend_found !== false) addtoFriendList (true, Rsi_LIVE_Token, friend_found.id, add, (data) => {});
					
				})
				
				
				if (add)
				{
					//FrienList.live.data.push(member);
				}
				else
				{
					$(FrienList.live.data).each( (index, current_member) => {
						if (current_member.nickname == member.nickname)
						{
							FrienList.live.data.splice(index, 1);
						}
					});
				}
				
				OrgMembers[SID] = [];
			}
		});		
		
		callback({success: 1, code: "OK", msg: "OK", data: AddedMembers});

	});
}



// Return News data from page
function getNews (Rsi_LIVE_Token, page, callback) {	
	page = page || 1;
	
	var current_timestamp = Math.floor(Date.now() / 1000);
	
	News.page_data = [];
	
	// return Ship List
	$.ajax({
		async: true,
		type: "post",
		contentType: 'application/json',
		url: base_LIVE_Url + "api/hub/getCommlinkItems",
		success: (result) => {

			if (result.success == 1)
			{
				var html = $('<div></div>');
				html.html(result.data.trim());

				$(html).find('a').each(function (i, elem) {
					var href = $(this).attr('href');
					var title = $(this).find('.title').text(); 
					var type = $(this).find('.type > span').text(); 
					var time_ago = $(this).find('.time_ago > span').text(); 
					var comments = $(this).find('.comments').text(); 
					var section = $(this).find('.section').text(); 
					var image = $(this).find('.background').css( 'background-image' );
					
					article_size = 3;
					if ($(this).hasClass('one_thrid')) article_size = 1;
					else if ($(this).hasClass('two_thirds')) article_size = 2;
					
					var article = {
						href: href,
						title: title,
						type: type,
						time_ago: time_ago,
						image: image,
						article_size: article_size,
						comments: comments,
						section: section,
						page: page,
					}
					
					article_index = News.data.findIndex(element => element.href == href);
					
					if (article_index < 0)
					{
						// new article
						article.timestamp = current_timestamp - i - (60*(page-1));
						News.data.push(article);
					}
					else
					{
						// existing article
						article.timestamp = News.data[article_index].timestamp;
						News.data[article_index] = article;
					}
					
					News.page_data.push(article);
				});
			}
			
			callback(News);
		},
		error: (request, status, error) => {
			callback({success: 0, code: "KO", msg: request.responseText});
		},
		headers: {
			"x-rsi-token": Rsi_LIVE_Token,
		},
		data: JSON.stringify({
			channel: "",
			series: "",
			type: "",
			text: "",
			sort: "publish_new",
			page: page,
		})
	});
}





// send Report
function sendReport (report_type, report_data, callback) {

	$.ajax({
		async: true,
		type: "post",
		contentType: 'application/json',
		url: "https://rsi-companion.kamille.ovh/sendReport",
		success: (result) => {
			current_timestamp = Math.floor(Date.now() / 1000);
			
			data = local_storage.report;
			if (typeof data == "undefined") data = {};

			data[report_type] = current_timestamp;
			
			chrome.storage.local.set({report: data}, () => {
				local_storage.report = data;
			});
			
			callback(result);
		},
		error: (request, status, error) => {
			callback({success: 0, code: "KO", msg: request.responseText});
		},
		data: JSON.stringify({
			type: report_type,
			data: report_data
		})
	});
}


// get Release Notes from RSI Companion
function getReleaseNotes (callback) {
	$.ajax({
		async: true,
		type: "get",
		contentType: 'application/json',
		url: "https://rsi-companion.kamille.ovh/getReleaseNotes",
		cache : true,
		success: (result) => {
			callback(result);
		},
		error: (request, status, error) => {
			callback({success: 0, code: "KO", msg: request.responseText});
		}
	});
}



function getReferrals(LIVE_Token, callback) {
	$.ajax({
		async: true,
		type: "get",
		url: base_LIVE_Url + "account/referral-program",
		cache : true,
		success: (result) => {
			var html = $.parseHTML( result );
			
			var url = base_LIVE_Url + 'enlist?referral=' + $(html).find('form#share-referral-form input[name="code"]').val();
			if (typeof url == "undefined") url = false;
			
			var start = $(html).find('.referral-rank-wrapper .progress span.start').text();
			if (typeof start == "undefined") start = false;
			var end = $(html).find('.referral-rank-wrapper .progress span.end').text();
			if (typeof end == "undefined") end = false;
			var next_rank = $(html).find('.referral-rank-wrapper .progress div.next-rank').text();
			if (typeof next_rank == "undefined") next_rank = false;
			
			var prospects = $(html).find('form#recruits-list-form a[data-type="pending"]').text();
			if (typeof prospects == "undefined") prospects = false;
			else
			{
				var matches = prospects.match(/(\d+)/);
				if (matches) prospects = matches[0];
				else prospects = false;
			}
			
			var recruits = $(html).find('form#recruits-list-form a[data-type="active"]').text();
			if (typeof recruits == "undefined") recruits = false;
			else
			{
				var matches = recruits.match(/(\d+)/);
				if (matches) recruits = matches[0];
				else recruits = false;
			}
			
			
			callback({success: 1, code: "OK", msg: "OK", data: {url: url, start: start, end: end, next_rank: next_rank, prospects: prospects, recruits: recruits}});
		},
		error: (request, status, error) => {
			callback({success: 0, code: "KO", msg: request.responseText});
		},
		headers: {
			"x-rsi-token": LIVE_Token,
		}
	});
}

var BuyBack_data;
function getBuyBack (LIVE_Token, page, callback)
{	
	page = page || 1;
	
	if (page == 1) BuyBack_data = [];
	
	$.ajax({
		async: true,
		type: "get",
		url: base_LIVE_Url + "account/buy-back-pledges?page=" + page + "&pagesize=100",
		cache : true,
		success: (result) => {
			var html = $.parseHTML( result );
			
			var nb_token = $(html).find('p.buy-back-warning > strong').text().trim();
			if (nb_token.length == 0) nb_token = 0;
			
			var nb_page = 1;
			var nb_page_href = $(html).find('div.pager a.raquo').attr('href');
			if (typeof nb_page_href != "undefined" )
			{
				var matches = nb_page_href.match(/(\d+)/);
				if (matches) nb_page = matches[0];
			}

			var bb_details = [];
			
			articles = $(html).find('article.pledge');
			var cpt = $(articles).length;
			if (cpt > 0)
			{
				$(articles).each((index, article) => {
					bb_name = $(article).find('div > div > h1').text().trim();
					bb_date = $(article).find('div > div > dl > dd:eq(0)').text().trim();
					bb_contained = $(article).find('div > div > dl > dd:eq(2)').text().trim();
					
					
					
					bb_button_href = $(article).find('a.holosmallbtn').attr('href');
					if (typeof bb_button_href == "undefined") bb_button_href = false;
					
					if (bb_button_href !== false && bb_button_href.length >=4 && bb_button_href.substr(0, 4) != 'http')
					{
						// URL doesn't start with http
						
						if (bb_button_href.substr(0, 1) == '/') bb_button_href = bb_button_href.substr(1);
						bb_button_href = base_LIVE_Url + bb_button_href;
					}
					
					var fromshipid = false;
					var toshipid = false;
					var toskuid = false;
					var pledgeid = false;
					
					if (bb_button_href !== false && bb_button_href.substr(0, 4) == 'http')
					{
						// sound like a URL, let's search for the pledgeid in it:
						var matches = bb_button_href.match(/(\d+)/);
						if (matches != null) pledgeid = matches[0];
					}
					
					var bb_url = bb_button_href;
					
					if (pledgeid == false)
					{
						//////////////////
						// Upgrade case //
						//////////////////
						bb_button_href = false;
						
						fromshipid = $(article).find('a.holosmallbtn').data('fromshipid');
						if (typeof fromshipid == "undefined") fromshipid = false;
						toshipid = $(article).find('a.holosmallbtn').data('toshipid');
						if (typeof toshipid == "undefined") toshipid = false;
						toskuid = $(article).find('a.holosmallbtn').data('toskuid');
						if (typeof toskuid == "undefined") toskuid = false;
						pledgeid = $(article).find('a.holosmallbtn').data('pledgeid');
						if (typeof pledgeid == "undefined") pledgeid = false;
						
						bb_url = base_LIVE_Url + "pledge?openshipupgrade=1&pledgeid=" + pledgeid + "&fromshipid=" + fromshipid + "&toshipid=" + toshipid + "&toskuid=" + toskuid + "";
					}
					
					found = BuyBack_data.findIndex(element => element.id == pledgeid);
					
					if (found < 0 && pledgeid !== false && bb_name.length > 0)
					{
						var pledge_type, pledge_name, pledge_option; 
						if (bb_name.includes(' - ')) var [pledge_type, pledge_name, pledge_option] = bb_name.split(' - ');
						
						if (typeof pledge_type == "undefined") pledge_type = '';
						if (typeof pledge_name == "undefined") pledge_name = '';
						if (typeof pledge_option == "undefined") pledge_option = '';
						
						data = {id: pledgeid, upgrade: {fromshipid: fromshipid, toshipid: toshipid, toskuid: toskuid}, full_name: bb_name, type: pledge_type, name: pledge_name, option: pledge_option, url: bb_url, date: bb_date, contained: bb_contained, price: '', currency: '', insurance: '', image: '/img/Image_not_found.png', ships: {}, items: {}};
						
						BuyBack_data.push(data);
						
						getBuyBackDetails(LIVE_Token, bb_button_href, data, (BuyBackDetails) => {
							data = BuyBackDetails.data;
							
							if (BuyBackDetails.success == 1)
							{
								var foundIndex = BuyBack_data.findIndex(element => element.id == data.id);
								BuyBack_data[foundIndex] = data;
							}
							
							bb_details.push(data);
							
							BuyBack = {success: 1, code: "OK", msg: "OK", data: {BuyBack: BuyBack_data, nb_token: nb_token}};
							
							if (bb_details.length == cpt)
							{
								// Page done!
								if (page < nb_page)
								{
									// There are still some pages to check
									getBuyBack (LIVE_Token, page + 1, callback);
									//callback(BuyBack);
								}
								else
								{
									// All done !
									callback(BuyBack);
								}
							}
							else{
								// Page not done yet
							}
						});
					}
					else cpt--;
				});
			}
			else
			{
				BuyBack = {success: 1, code: "OK", msg: "OK", data: {BuyBack: BuyBack_data, nb_token: nb_token}};
				callback(BuyBack);
			}
		},
		error: (request, status, error) => {
			callback({success: 0, code: "KO", msg: request.responseText});
		},
		headers: {
			"x-rsi-token": LIVE_Token,
		}
	});
}


function getBuyBackDetails (LIVE_Token, bb_button_href, DATA, callback)
{
	
	if (bb_button_href != false)
	{
		$.ajax({
			async: true,
			type: "get",
			url: bb_button_href,
			cache : true,
			success: (result) => {
				var html = $.parseHTML( result );
				
				var image = $(html).find('figure > img').attr('src');
				if (typeof image != "undefined")
				{
					if (image.substr(0, 4) != 'http')
					{
						if (image.substr(0, 1) == '/') image = image.substr(1);
						image = base_LIVE_Url + image;
					}
				}
				else image = '';
				
				DATA.image = image;

				currency = '';
				price = 0;
				
				var final_price = $(html).find('strong.final-price');				
				if (typeof final_price != "undefined")
				{
					currency = final_price.data('currency');
					if (typeof currency == "undefined") currency = '';
					
					price = final_price.data('value');
					if (typeof price == "undefined") price = 0;
					else price = final_price.data('value')/100;
				}
				
				DATA.currency = currency;
				DATA.price = price;


				
				var ships = [];
				const ships_li = $(html).find('div.ship > ul > li');
				$(ships_li).each((index, ship) => {
					ship_image = $(ship).find('img').attr('src');
					if (typeof ship_image != "undefined")
					{
						if (ship_image.length >= 4 && ship_image.substr(0, 4) != 'http')
						{
							if (ship_image.substr(0, 1) == '/') ship_image = ship_image.substr(1);
							ship_image = base_LIVE_Url + ship_image;
						}
					}
					else ship_image = '';
					
					ship_name = $(ship).find('div.info:eq(0) > span').text().trim();
					ship_manufacturer = $(ship).find('div.info:eq(1) > span').text().trim();
					ship_focus = $(ship).find('div.info:eq(2) > span').text().trim();
					
					ships.push({ship_image: ship_image, ship_name: ship_name, ship_manufacturer: ship_manufacturer, ship_focus: ship_focus});
				});
				
				var items = [];
				var insurance = '';
				const contains = $(html).find('div.package-listing.item > ul > li');
				$(contains).each((index, contain) => {
					contain_text = $(contain).text().trim();
					
					if (contain_text.length > 0)
					{
						items.push(contain_text);
					
						if (contain_text.includes('Insurance'))
						{
							[insurance] = contain_text.split('Insurance');
						
							if (typeof insurance == "undefined") insurance = '';
							insurance = insurance.trim();
						}
					}
				});
				
				DATA.insurance = insurance;
				DATA.items = items;
				
				if (ships.length == 0 && insurance.length > 0)
				{
					// PTV ?
					greycatPTV = $(html).find('div.package-listing.item > ul > li:contains(\'Greycat PTV\')').text().trim();
					if (greycatPTV.length > 0)
					{
						ships.push({ship_image: 'https://i.imgur.com/8cfQ32V.jpg', ship_name: 'Greycat PTV', ship_manufacturer: 'Greycat Industrial', ship_focus: 'Transport'});
					}
				}
				DATA.ships = ships;

				callback({success: 1, code: "OK", msg: "OK", data: DATA});
			},
			error: (request, status, error) => {
				callback({success: 0, code: "KO", msg: request.responseText, data: DATA});
			},
			headers: {
				"x-rsi-token": LIVE_Token,
			}
		});
	}
	else if (DATA.upgrade.fromshipid !== false && DATA.upgrade.toshipid !== false && DATA.upgrade.toskuid !== false && DATA.id !== false)
	{
		$.ajax({
			async: true,
			type: "post",
			url: base_LIVE_Url + "api/account/v2/setAuthToken",
			success: (result) => {									
				$.ajax({
					async: true,
					type: "post",
					url: base_LIVE_Url + "api/ship-upgrades/setContextToken",
					success: (result) => {
						$.ajax({
							async: true,
							type: "post",
							contentType: 'application/json',
							url: base_LIVE_Url + "pledge-store/api/upgrade",
							success: (result) => {
								currency = result[0].data.app.pricing.currencyCode;
								if (typeof currency == "undefined") currency = '';
								
								DATA.currency = currency;
								
								$.ajax({
									async: true,
									type: "post",
									contentType: 'application/json',
									url: base_LIVE_Url + "pledge-store/api/upgrade",
									success: (result) => {
										var price = 0;
										if (result[0].data.price != null) price = result[0].data.price.amount;
										if (typeof price == "undefined") price = 0;
										
										DATA.price = price/100;
										
										callback({success: 1, code: "OK", msg: "OK", data: DATA});
									},
									error: (request, status, error) => {
										callback({success: 0, code: "KO", msg: request.responseText, data: DATA});
									},
									data: "[{\"operationName\":\"getPrice\",\"variables\":{\"from\": " + DATA.upgrade.fromshipid + ",\"to\": " + DATA.upgrade.toskuid + "},\"query\":\"query getPrice($from: Int!, $to: Int!) {\\n  price(from: $from, to: $to) {\\n    amount\\n  }\\n}\\n\"}]",
									headers: { "x-rsi-token": LIVE_Token }
								});
							},
							error: (request, status, error) => {
								callback({success: 0, code: "KO", msg: request.responseText, data: DATA});
							},
							data: "[{\"operationName\":\"initShipUpgrade\",\"variables\":{},\"query\":\"query initShipUpgrade {\\n  ships {\\n    id\\n    name\\n    medias {\\n      productThumbMediumAndSmall\\n      slideShow\\n    }\\n    manufacturer {\\n      id\\n      name\\n    }\\n    focus\\n    type\\n    flyableStatus\\n    owned\\n    msrp\\n    link\\n    skus {\\n      id\\n      title\\n      available\\n      price\\n      body\\n    }\\n  }\\n  manufacturers {\\n    id\\n    name\\n  }\\n  app {\\n    version\\n    env\\n    cookieName\\n    sentryDSN\\n    pricing {\\n      currencyCode\\n      currencySymbol\\n      exchangeRate\\n      taxRate\\n      isTaxInclusive\\n    }\\n    mode\\n    isAnonymous\\n    buyback {\\n      credit\\n    }\\n  }\\n}\\n\"}]",
							headers: { "x-rsi-token": LIVE_Token }
						});
						
						
					},
					error: (request, status, error) => {
						callback({success: 0, code: "KO", msg: request.responseText, data: DATA});
					},
					data: {
						"fromShipId": DATA.upgrade.fromshipid,
						"toShipId": DATA.upgrade.toshipid,
						"toSkuId": DATA.upgrade.toskuid,
						"pledgeId": DATA.upgrade.id
					},
					headers: { "x-rsi-token": LIVE_Token }
				});
			},
			error: (request, status, error) => {
				callback({success: 0, code: "KO", msg: request.responseText, data: DATA});
			},
			data: {
				"fromShipId": DATA.upgrade.fromshipid,
				"toShipId": DATA.upgrade.toshipid,
				"toSkuId": DATA.upgrade.toskuid,
				"pledgeId": DATA.upgrade.id
			},
			headers: { "x-rsi-token": LIVE_Token }
		});
	}
	else callback({success: 1, code: "OK", msg: "OK", data: DATA});
}



function addToCart (LIVE_Token, fromShipId, toShipId, toSkuId, pledgeId, callback)
{
	if (fromShipId == false)
	{
		$.ajax({
			async: true,
			type: "post",
			url: base_LIVE_Url + "api/store/buyBackPledge",
			success: (result) => {									
				callback({success: 1, code: "OK", msg: 'OK', data: {}});
			},
			error: (request, status, error) => {
				callback({success: 0, code: "KO", msg: 'KO', data: {}});
			},
			data: {
				"id": pledgeId
			},
			headers: { "x-rsi-token": LIVE_Token }
		});
	}
	else
	{
		$.ajax({
			async: true,
			type: "post",
			url: base_LIVE_Url + "api/account/v2/setAuthToken",
			success: (result) => {									
				$.ajax({
					async: true,
					type: "post",
					url: base_LIVE_Url + "api/ship-upgrades/setContextToken",
					success: (result) => {
						$.ajax({
							async: true,
							type: "post",
							contentType: 'application/json',
							url: base_LIVE_Url + "pledge-store/api/upgrade",
							success: (result) => {
								
								$.ajax({
									async: true,
									type: "post",
									contentType: 'application/json',
									url: base_LIVE_Url + "pledge-store/api/upgrade",
									success: (result) => {
										$.ajax({
											async: true,
											type: "post",
											contentType: 'application/json',
											url: base_LIVE_Url + "pledge-store/api/upgrade",
											success: (result) => {
												if (typeof(result[0]) != undefined)
												{
													$.ajax({
														async: true,
														type: "post",
														contentType: 'application/json',
														url: base_LIVE_Url + "api/store/v2/cart/token",
														success: (result2) => {
															callback({success: 1, code: "OK", msg: "OK", data: {}});
														},
														error: (request, status, error) => {
															callback({success: 0, code: "KO", msg: request.responseText, data: {}});
														},
														data: "{\"jwt\":\"" + result[0].data.addToCart.jwt + "\"}",
														headers: { "x-rsi-token": LIVE_Token }
													});
												}
											},
											error: (request, status, error) => {
												callback({success: 0, code: "KO", msg: request.responseText, data: {}});
											},
											data: "[{\"operationName\":\"addToCart\",\"variables\":{\"from\": " + fromShipId + ",\"to\": " + toSkuId + "},\"query\":\"mutation addToCart($from: Int!, $to: Int!) {\\n  addToCart(from: $from, to: $to) {\\n    jwt\\n  }\\n}\\n\"}]",
											headers: { "x-rsi-token": LIVE_Token }
										});
									},
									error: (request, status, error) => {
										callback({success: 0, code: "KO", msg: request.responseText, data: {}});
									},
									data: "[{\"operationName\":\"getPrice\",\"variables\":{\"from\": " + fromShipId + ",\"to\": " + toSkuId + "},\"query\":\"query getPrice($from: Int!, $to: Int!) {\\n  price(from: $from, to: $to) {\\n    amount\\n  }\\n}\\n\"}]",
									headers: { "x-rsi-token": LIVE_Token }
								});
							},
							error: (request, status, error) => {
								callback({success: 0, code: "KO", msg: request.responseText, data: {}});
							},
							data: "[{\"operationName\":\"initShipUpgrade\",\"variables\":{},\"query\":\"query initShipUpgrade {\\n  ships {\\n    id\\n    name\\n    medias {\\n      productThumbMediumAndSmall\\n      slideShow\\n    }\\n    manufacturer {\\n      id\\n      name\\n    }\\n    focus\\n    type\\n    flyableStatus\\n    owned\\n    msrp\\n    link\\n    skus {\\n      id\\n      title\\n      available\\n      price\\n      body\\n    }\\n  }\\n  manufacturers {\\n    id\\n    name\\n  }\\n  app {\\n    version\\n    env\\n    cookieName\\n    sentryDSN\\n    pricing {\\n      currencyCode\\n      currencySymbol\\n      exchangeRate\\n      taxRate\\n      isTaxInclusive\\n    }\\n    mode\\n    isAnonymous\\n    buyback {\\n      credit\\n    }\\n  }\\n}\\n\"}]",
							headers: { "x-rsi-token": LIVE_Token }
						});
					},
					error: (request, status, error) => {
						callback({success: 0, code: "KO", msg: request.responseText, data: {}});
					},
					data: {
						"fromShipId": fromShipId,
						"toShipId": toShipId,
						"toSkuId": toSkuId,
						"pledgeId": pledgeId
					},
					headers: { "x-rsi-token": LIVE_Token }
				});
			},
			error: (request, status, error) => {
				callback({success: 0, code: "KO", msg: request.responseText, data: {}});
			},
			data: {},
			headers: { "x-rsi-token": LIVE_Token }
		});
	}
}


function Vote (LIVE_Token, ID, Discard, callback)
{
	$.ajax({
		async: true,
		type: "post",
		url: base_LIVE_Url + "api/community/vote",
		success: (result) => {
			callback(result);
		},
		error: (request, status, error) => {
			callback({success: 0, code: "KO", msg: request.responseText, data: {}});
		},
		contentType: 'application/json',
		data: JSON.stringify({
			id: ID,
			type: "citizen-spotlight",
			discard :Discard
		}),
		headers: { "x-rsi-token": LIVE_Token }
	});
}

function getServiceStatus (callback)
{
	/*
	https://status.robertsspaceindustries.com/static/content/api/v0/incidents.page-1.en.json
	https://status.robertsspaceindustries.com/static/content/api/v0/incidents/timeline.en.json
	https://status.robertsspaceindustries.com/static/content/api/v0/systems.en.json
	*/
	
	$.ajax({
		async: true,
		type: "get",
		contentType: 'application/json',
		url: "https://status.robertsspaceindustries.com/index.json",
		success: (result) => {
			var status_result = result.systems;
			if (typeof local_storage.report == "undefined") local_storage.report = {};
			callback(status_result);
		},
		error: (request, status, error) => {
			callback({success: 0, code: "KO", msg: request.responseText, data: {}});
		},
	});
}



// background Listener, called from other .js scripts
chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
	
	current_timestamp = Math.floor(Date.now() / 1000);
	
	if (message && message.type == 'GetAppTitle') {		
		sendResponse({AppTitle: AppTitle, AppSmallTitle: AppSmallTitle, AppVersion: AppVersion});
		return true; // keep the messaging channel open for sendResponse
	}
	else if (message && message.type == 'getCrowdfundStats') {
		(async () => {			
			getCrowdfundStats((data) => {
				sendResponse(data);
			});
		})();
		return true; // keep the messaging channel open for sendResponse
	}
	else if (message && message.type == 'setBadge') {		
		setBadge (message.text, message.bg_color)
		sendResponse({});
		return true; // keep the messaging channel open for sendResponse
	}
	else if (message && message.type == 'CheckConnection') {
		(async () => {			
			CheckConnection(message.force, (data) => {
				show_log('CheckConnection DONE from Message: ' + message.from);
				sendResponse(data);
			});
		})();
		return true; // keep the messaging channel open for sendResponse
	}
	else if (message && message.type == 'identify') {
		(async () => {			
			Identify(message.LIVE, message.Token, (data) => {
				sendResponse(data);
			});
		})();
		return true; // keep the messaging channel open for sendResponse
	}
	else if (message && message.type == 'changeOrgFollow') {
		(async () => {			
			changeOrgFollow(message.LIVE_Token, message.PTU_Token, message.organization, true, (data) => {
				sendResponse(data);
			});
		})();
		return true; // keep the messaging channel open for sendResponse
	}
	else if (message && message.type == 'SearchContact') {
		(async () => {
			SearchContact(message.LIVE, message.Token, message.Query, (data) => {
				sendResponse(data);
			});
		})();
		return true; // keep the messaging channel open for sendResponse
	}
	else if (message && message.type == 'getFriendRequests') {
		(async () => {			
			getFriendRequests(message.LIVE, message.Token, (data) => {
				sendResponse(data);
			});
		})();
		return true; // keep the messaging channel open for sendResponse
	}
	else if (message && message.type == 'CancelFriendRequest') {
		(async () => {			
			CancelFriendRequest(message.Token, message.request_id, (data) => {
				sendResponse(data);
			});
		})();
		return true; // keep the messaging channel open for sendResponse
	}
	else if (message && message.type == 'AcceptFriendRequest') {
		(async () => {			
			AcceptFriendRequest(message.Token, message.request_id, (data) => {
				sendResponse(data);
			});
		})();
		return true; // keep the messaging channel open for sendResponse
	}
	else if (message && message.type == 'DeclineFriendRequest') {
		(async () => {			
			DeclineFriendRequest(message.Token, message.request_id, (data) => {
				sendResponse(data);
			});
		})();
		return true; // keep the messaging channel open for sendResponse
	}
	else if (message && message.type == 'getFriends') {
		(async () => {
			if (message.LIVE) this_friend_list = FrienList.live;
			else this_friend_list = FrienList.ptu;
			
			getFriends(message.LIVE, message.Token, (data) => {
				
				if (message.LIVE) FrienList.live = data;
				else FrienList.ptu = data;
				
				sendResponse(data);
			});
		})();
		return true; // keep the messaging channel open for sendResponse
	}
	else if (message && message.type == 'addtoFriendList') {
		(async () => {
			addtoFriendList (message.LIVE, message.Token, message.member_id, message.Add, (data) => {
				// refresh friend list
				getFriends(message.LIVE, message.Token, (data2) => {
					//data2.cached_since = current_timestamp;
					
					if (message.LIVE) FrienList.live = data2;
					else FrienList.ptu = data2;
					
					sendResponse(data);
				});
			});
		})();
		return true; // keep the messaging channel open for sendResponse
	}
	else if (message && message.type == 'getOrganizations') {
		(async () => {
			if (OrgList.length == 0 || (current_timestamp - OrgList.cached_since) > cache_expiration_after_sec)
			{
				getOrganizations ((data) => {
					data.cached_since = current_timestamp;
					
					OrgList = data;
					sendResponse(OrgList);
				})
			}
			else sendResponse(OrgList);
			
		})();
		return true; // keep the messaging channel open for sendResponse
    }
	else if (message && message.type == 'getOrgMembers') {
		(async () => {
			if (typeof OrgMembers[message.SID] == "undefined") OrgMembers[message.SID] = [];
			
			if (OrgMembers[message.SID].length == 0)
			{				
				getOrgMembers (message.Token, message.SID, message.Handle, 1, (data) => {
					data.cached_since = current_timestamp;
					
					OrgMembers[message.SID] = data;
					
					sendResponse(data);
				});
			}
			else sendResponse(OrgMembers[message.SID]);
		})();
		return true; // keep the messaging channel open for sendResponse
    }
	else if (message && message.type == 'addOrganizationMembers') {
		(async () => {
			AddedMembers = [];
			// refresh friend list
			getFriends (true, message.Token, () => {
				addOrganizationMembers (message.Token, message.SID, message.Handle, message.Add, 1, (data) => {
					sendResponse(data);
				});
			});
		})();
		return true; // keep the messaging channel open for sendResponse
    }
	else if (message && message.type == 'getNews') {
		(async () => {
			getNews (message.Token, message.page, (getNews) => {				
				if (message.page == 1) getNews.last_read = current_timestamp;
				getNews.total = $(getNews.data).length;
					
				chrome.storage.local.set({News: getNews}, () => {
					News = getNews;
					local_storage.News = News;
					News.page = message.page;
					
					sendResponse(News);
				});
			});
		})();
		return true; // keep the messaging channel open for sendResponse
    }
	else if (message && message.type == 'getBoards') {
		(async () => {
			getBoards ((data) => {
				sendResponse(data);
			});
		})();
		return true; // keep the messaging channel open for sendResponse
    }
	else if (message && message.type == 'getBoardData') {
		(async () => {
			getBoardData (message.BoardID, message.BoardLastUpdated, (data) => {
				data.cached_since = current_timestamp;
				
				BoardData[message.BoardID] = data;
				sendResponse(BoardData[message.BoardID]);
			});
		})();
		return true; // keep the messaging channel open for sendResponse
    }
	else if (message && message.type == 'getTelemetry') {
		(async () => {
			if (Telemetry.length == 0)
			{
				getTelemetry (message.LIVE_Token, (data) => {
					data.cached_since = current_timestamp;
					
					Telemetry = data;
					sendResponse(Telemetry);
				});
			}
			else sendResponse(Telemetry);			
		})();
		return true; // keep the messaging channel open for sendResponse
    }
	else if (message && message.type == 'getShipList') {
		(async () => {
			ShipList = local_storage.ShipList;
			
			if (message.refresh == true || typeof ShipList.cached_since == "undefined")
			{
				getShipList (message.Token, (data) => {
					data.cached_since = current_timestamp;
					
					chrome.storage.local.set({ShipList: data}, () => {
						ShipList = data;
						local_storage.ShipList = ShipList;
						sendResponse(ShipList);
					});
				});
			}
			else sendResponse(ShipList);
		})();
		return true; // keep the messaging channel open for sendResponse
    }
	else if (message && message.type == 'SpectrumThreadNested') {
		(async () => {
			SpectrumThreadNested (message.LIVE_Token, message.slug, (data) => {
				sendResponse(data);
			});
		})();
		return true; // keep the messaging channel open for sendResponse
	}
	else if (message && message.type == 'SpectrumReadAllNotifications') {
		(async () => {
			SpectrumReadAllNotifications (message.LIVE_Token, (data) => {
				sendResponse(data);
			});
		})();
		return true; // keep the messaging channel open for sendResponse
	}
	else if (message && message.type == 'SpectrumRead') {
		(async () => {
			SpectrumRead (message.LIVE_Token, message.notification_id, (data) => {
				sendResponse(data);
			});
		})();
		return true; // keep the messaging channel open for sendResponse
    }
	else if (message && message.type == 'getSpectrumThreads') {
		(async () => {
			getSpectrumThreads (message.LIVE_Token, message.channel_id, (data) => {
				sendResponse(data);
			});
		})();
		return true; // keep the messaging channel open for sendResponse
    }
	else if (message && message.type == 'sendReport') {
		(async () => {
			sendReport (message.report_type, message.report_data, (data) => {
				sendResponse(data);
			});
		})();
		return true; // keep the messaging channel open for sendResponse
    }
	else if (message && message.type == 'getReleaseNotes') {
		(async () => {
			getReleaseNotes ((data) => {
				sendResponse(data);
			});
		})();
		return true; // keep the messaging channel open for sendResponse
    }
	else if (message && message.type == 'getReferrals') {
		(async () => {
			getReferrals (message.Token, (data) => {
				sendResponse(data);
			});
		})();
		return true; // keep the messaging channel open for sendResponse
    }
	else if (message && message.type == 'getBuyBack') {
		(async () => {
			BuyBack = local_storage.BuyBack;
			
			if (message.refresh == true || typeof BuyBack.cached_since == "undefined")
			{
				getBuyBack (message.Token, 1, (data) => {
					data.cached_since = current_timestamp;
					
					chrome.storage.local.set({BuyBack: data}, () => {
						BuyBack = data;
						local_storage.BuyBack = BuyBack;
						sendResponse(BuyBack);
					});
				});
			}
			else sendResponse(BuyBack);
		})();
		return true; // keep the messaging channel open for sendResponse
    }
	else if (message && message.type == 'getBuyBackCachedSince') {
		(async () => {
			BuyBack = local_storage.BuyBack;
			
			if (typeof BuyBack.cached_since != "undefined") sendResponse({success: 1, code: "OK", msg: "OK", cached_since: BuyBack.cached_since});
			else sendResponse({success: 0, code: "KO", msg: "KO"});
		})();
		return true; // keep the messaging channel open for sendResponse
    }
	else if (message && message.type == 'getShipListCachedSince') {
		(async () => {
			ShipList = local_storage.ShipList;
			
			if (typeof ShipList.cached_since != "undefined") sendResponse({success: 1, code: "OK", msg: "OK", cached_since: ShipList.cached_since});
			else sendResponse({success: 0, code: "KO", msg: "KO"});
		})();
		return true; // keep the messaging channel open for sendResponse
    }
	else if (message && message.type == 'addToCart') {
		(async () => {
			addToCart(message.Token, message.fromShipId, message.toShipId, message.toSkuId, message.pledgeId, (data) => {
				sendResponse(data);
			});
		})();
		return true; // keep the messaging channel open for sendResponse
    }
	else if (message && message.type == 'Vote') {
		(async () => {
			Vote(message.Token, message.ID, message.Discard, (data) => {
				sendResponse(data);
			});
		})();
		return true; // keep the messaging channel open for sendResponse
    }
	
});