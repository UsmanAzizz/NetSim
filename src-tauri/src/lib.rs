use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream, UdpSocket};
use std::sync::atomic::{AtomicBool, AtomicU16, Ordering};
use std::sync::{Mutex, RwLock};
use std::thread;
use std::time::Duration;
use std::process::Command;
use tauri::{AppHandle, Emitter};

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileAttachment {
    #[serde(default)]
    pub id: String,
    pub name: String,
    pub size: u64,
    pub mime_type: String,
    pub url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct PeerPayload {
    name: String,
    role: String,
    ip: String,
    interface: String,
    #[serde(default)]
    is_app: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct AlertPayload {
    #[serde(default)]
    id: String,
    sender: String,
    message: String,
    #[serde(default)]
    sender_ip: Option<String>,
    #[serde(default)]
    file: Option<FileAttachment>,
}

struct StoredFile {
    name: String,
    mime_type: String,
    bytes: Vec<u8>,
}

static SHARED_FILES: Mutex<Option<HashMap<String, StoredFile>>> = Mutex::new(None);
static HTTP_PORT: AtomicU16 = AtomicU16::new(0);

static RADAR_RUNNING: AtomicBool = AtomicBool::new(false);
static MSG_COUNTER: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);
static CURRENT_NAME: RwLock<String> = RwLock::new(String::new());
static CURRENT_ROLE: RwLock<String> = RwLock::new(String::new());
static BEST_IP: RwLock<String> = RwLock::new(String::new());
static BEST_IFACE: RwLock<String> = RwLock::new(String::new());

fn handle_http_connection(stream: &mut TcpStream) {
    let mut buffer = [0; 2048];
    let bytes_read = match stream.read(&mut buffer) {
        Ok(n) if n > 0 => n,
        _ => return,
    };

    let req_str = String::from_utf8_lossy(&buffer[..bytes_read]);
    let mut lines = req_str.lines();
    let req_line = match lines.next() {
        Some(l) => l,
        None => return,
    };

    let parts: Vec<&str> = req_line.split_whitespace().collect();
    if parts.len() < 2 || parts[0] != "GET" {
        let response = "HTTP/1.1 405 Method Not Allowed\r\nConnection: close\r\n\r\n";
        let _ = stream.write_all(response.as_bytes());
        return;
    }

    let path = parts[1];
    if let Some(file_id) = path.strip_prefix("/file/") {
        let clean_id = file_id.split('?').next().unwrap_or(file_id);
        
        let file_opt = {
            if let Ok(lock) = SHARED_FILES.lock() {
                if let Some(map) = &*lock {
                    map.get(clean_id).map(|f| (f.name.clone(), f.mime_type.clone(), f.bytes.clone()))
                } else {
                    None
                }
            } else {
                None
            }
        };

        if let Some((name, mime_type, data)) = file_opt {
            let headers = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: {}\r\nContent-Length: {}\r\nAccess-Control-Allow-Origin: *\r\nContent-Disposition: inline; filename=\"{}\"\r\nConnection: close\r\n\r\n",
                mime_type,
                data.len(),
                name
            );
            let _ = stream.write_all(headers.as_bytes());
            let _ = stream.write_all(&data);
            let _ = stream.flush();
            return;
        }
    }

    let not_found = "HTTP/1.1 404 Not Found\r\nAccess-Control-Allow-Origin: *\r\nConnection: close\r\n\r\nFile Not Found";
    let _ = stream.write_all(not_found.as_bytes());
}

fn start_http_file_server() {
    let listener = TcpListener::bind("0.0.0.0:8890")
        .or_else(|_| TcpListener::bind("0.0.0.0:0"))
        .expect("Failed to bind TCP listener for file sharing");
        
    let port = listener.local_addr().unwrap().port();
    HTTP_PORT.store(port, Ordering::SeqCst);

    thread::spawn(move || {
        for stream in listener.incoming() {
            if let Ok(mut stream) = stream {
                thread::spawn(move || {
                    handle_http_connection(&mut stream);
                });
            }
        }
    });
}

#[tauri::command]
fn register_file_for_sharing(name: String, mime_type: String, bytes: Vec<u8>) -> Result<FileAttachment, String> {
    let file_id = format!(
        "f_{}_{}",
        std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_millis(),
        MSG_COUNTER.fetch_add(1, Ordering::Relaxed)
    );

    let size = bytes.len() as u64;

    if let Ok(mut lock) = SHARED_FILES.lock() {
        let map = lock.get_or_insert_with(HashMap::new);
        map.insert(file_id.clone(), StoredFile {
            name: name.clone(),
            mime_type: mime_type.clone(),
            bytes,
        });
    }

    let ip = {
        let guard = BEST_IP.read().unwrap_or_else(|e| e.into_inner());
        if !guard.is_empty() && *guard != "127.0.0.1" {
            guard.clone()
        } else {
            local_ip_address::local_ip().map(|i| i.to_string()).unwrap_or_else(|_| "127.0.0.1".to_string())
        }
    };
    let port = HTTP_PORT.load(Ordering::SeqCst);

    let url = format!("http://{}:{}/file/{}", ip, port, file_id);

    Ok(FileAttachment {
        id: file_id,
        name,
        size,
        mime_type,
        url,
    })
}

#[tauri::command]
fn save_file_to_downloads(filename: String, bytes: Vec<u8>) -> Result<String, String> {
    let download_dir = if let Ok(profile) = std::env::var("USERPROFILE") {
        std::path::PathBuf::from(profile).join("Downloads")
    } else {
        std::env::current_dir().unwrap_or_default()
    };
    
    std::fs::create_dir_all(&download_dir).map_err(|e| e.to_string())?;

    let mut file_path = download_dir.join(&filename);
    if file_path.exists() {
        let stem = std::path::Path::new(&filename)
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("file");
        let ext = std::path::Path::new(&filename)
            .extension()
            .and_then(|s| s.to_str())
            .unwrap_or("");
        
        for i in 1..1000 {
            let new_name = if ext.is_empty() {
                format!("{} ({})", stem, i)
            } else {
                format!("{} ({}).{}", stem, i, ext)
            };
            let candidate = download_dir.join(&new_name);
            if !candidate.exists() {
                file_path = candidate;
                break;
            }
        }
    }

    std::fs::write(&file_path, bytes).map_err(|e| e.to_string())?;

    #[cfg(target_os = "windows")]
    {
        let mut cmd = Command::new("explorer");
        let win_path = file_path.to_string_lossy().replace("/", "\\");
        cmd.raw_arg(format!("/select,\"{}\"", win_path));
        let _ = cmd.spawn();
    }

    Ok(file_path.to_string_lossy().to_string())
}

fn send_instant_beacon() {
    let name = CURRENT_NAME.read().map(|n| n.clone()).unwrap_or_else(|_| "Siswa".to_string());
    let role = CURRENT_ROLE.read().map(|r| r.clone()).unwrap_or_else(|_| "student".to_string());
    let ip = BEST_IP.read().map(|ip| ip.clone()).unwrap_or_else(|_| "127.0.0.1".to_string());
    let iface = BEST_IFACE.read().map(|iface| iface.clone()).unwrap_or_else(|_| "Unknown".to_string());

    if ip == "127.0.0.1" || ip.is_empty() {
        return;
    }

    if let Ok(socket) = UdpSocket::bind("0.0.0.0:0") {
        let _ = socket.set_broadcast(true);
        let payload = PeerPayload {
            name,
            role,
            ip: ip.clone(),
            interface: iface,
            is_app: true,
        };
        if let Ok(bytes) = serde_json::to_string(&payload) {
            let _ = socket.send_to(bytes.as_bytes(), "255.255.255.255:8888");
            if let Some(idx) = ip.rfind('.') {
                let subnet_bcast = format!("{}.255:8888", &ip[..idx]);
                let _ = socket.send_to(bytes.as_bytes(), subnet_bcast);
            }
            if let Ok(interfaces) = local_ip_address::list_afinet_netifas() {
                for (_name, if_ip) in interfaces.iter() {
                    let if_str = if_ip.to_string();
                    if if_ip.is_ipv4() && !if_str.starts_with("127.") && !if_str.starts_with("169.254.") {
                        if let Some(idx) = if_str.rfind('.') {
                            let _ = socket.send_to(bytes.as_bytes(), format!("{}.255:8888", &if_str[..idx]));
                        }
                    }
                }
            }
        }
    }
}

#[tauri::command]
fn update_node_name(name: String) -> Result<String, String> {
    if let Ok(mut cur_name) = CURRENT_NAME.write() {
        *cur_name = name;
    }
    send_instant_beacon();
    Ok("Nama node berhasil diperbarui dan disiarkan".to_string())
}

#[tauri::command]
async fn execute_ping(ip: String) -> Result<String, String> {
    let mut cmd = Command::new("ping");
    cmd.arg("-n").arg("4").arg("-w").arg("1000").arg(&ip);
    #[cfg(target_os = "windows")]
    cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    
    let output = cmd.output()
        .map_err(|e| format!("Gagal menjalankan perintah ping: {}", e))?;
        
    let result_text = String::from_utf8_lossy(&output.stdout).to_string();
    Ok(result_text)
}

// Fitur Baru: Mengirim pesan UDP Unicast ke spesifik IP
#[tauri::command]
fn send_alert(target_ip: String, sender: String, message: String) -> Result<String, String> {
    let socket = UdpSocket::bind("0.0.0.0:0").map_err(|e| e.to_string())?;
    let id = format!("{}-{}", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_millis(), MSG_COUNTER.fetch_add(1, Ordering::Relaxed));
    let payload = AlertPayload { id, sender, message, sender_ip: None, file: None };
    let bytes = serde_json::to_string(&payload).unwrap();
    
    // Kirim ke port 8889 khusus untuk alert
    socket.send_to(bytes.as_bytes(), format!("{}:8889", target_ip))
        .map_err(|e| format!("Gagal mengirim pesan: {}", e))?;
        
    Ok("Pesan alert terkirim!".to_string())
}

// Fitur Ruang Chat: Menyiarkan pesan chat ke seluruh jaringan LAN
#[tauri::command]
fn broadcast_chat(
    id: Option<String>, 
    sender: String, 
    message: String, 
    peer_ips: Vec<String>,
    file: Option<FileAttachment>
) -> Result<String, String> {
    let socket = UdpSocket::bind("0.0.0.0:0").map_err(|e| e.to_string())?;
    let _ = socket.set_broadcast(true);

    let msg_id = id.unwrap_or_else(|| {
        format!("{}-{}", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_millis(), MSG_COUNTER.fetch_add(1, Ordering::Relaxed))
    });

    let payload = AlertPayload { id: msg_id, sender, message, sender_ip: None, file };
    let bytes = serde_json::to_string(&payload).unwrap();

    let mut sent_subnets = std::collections::HashSet::new();

    // 1. Subnet broadcast untuk setiap antarmuka fisik yang aktif
    if let Ok(network_interfaces) = local_ip_address::list_afinet_netifas() {
        for (_if_name, ip) in network_interfaces.iter() {
            let ip_str = ip.to_string();
            if ip.is_ipv4() && !ip_str.starts_with("127.") && !ip_str.starts_with("169.254.") {
                if let Some(idx) = ip_str.rfind('.') {
                    let subnet_bcast = format!("{}.255:8889", &ip_str[..idx]);
                    if sent_subnets.insert(subnet_bcast.clone()) {
                        let _ = socket.send_to(bytes.as_bytes(), &subnet_bcast);
                    }
                }
            }
        }
    }

    // 2. Global broadcast fallback jika tidak ada subnet fisik
    if sent_subnets.is_empty() {
        let _ = socket.send_to(bytes.as_bytes(), "255.255.255.255:8889");
    }

    // 3. Unicast langsung ke seluruh IP peer yang terdeteksi
    for ip in peer_ips {
        if !ip.is_empty() {
            let _ = socket.send_to(bytes.as_bytes(), format!("{}:8889", ip));
        }
    }

    Ok("Pesan chat berhasil disiarkan!".to_string())
}

#[tauri::command]
fn start_radar(app: AppHandle, name: String, role: String) -> Result<String, String> {
    if let Ok(mut cur_name) = CURRENT_NAME.write() {
        *cur_name = name;
    }
    if let Ok(mut cur_role) = CURRENT_ROLE.write() {
        *cur_role = role;
    }

    if RADAR_RUNNING.swap(true, Ordering::SeqCst) {
        send_instant_beacon();
        return Ok("Radar already running, updated node name".to_string());
    }

    let port = 8888;
    
    let listener = UdpSocket::bind(format!("0.0.0.0:{}", port))
        .map_err(|e| format!("Bind error: {}", e))?;
    listener.set_nonblocking(true).unwrap_or(());

    // Deteksi interface & IP terbaik
    let mut best_ip = "127.0.0.1".to_string();
    let mut best_interface = "Unknown".to_string();

    if let Ok(network_interfaces) = local_ip_address::list_afinet_netifas() {
        for (if_name, ip) in network_interfaces.iter() {
            let lower_name = if_name.to_lowercase();
            
            if lower_name.contains("virtual") || lower_name.contains("vmnet") || lower_name.contains("vethernet") || lower_name.contains("loopback") {
                continue;
            }
            
            if ip.is_ipv4() && (lower_name.contains("ethernet") || lower_name.contains("eth") || lower_name.contains("wi-fi") || lower_name.contains("wifi") || lower_name.contains("wireless") || lower_name.contains("local area connection")) {
                let ip_str = ip.to_string();
                if !ip_str.starts_with("169.254.") {
                    best_ip = ip_str;
                    best_interface = if_name.clone();
                    break; 
                }
            }
        }
    }

    if best_ip == "127.0.0.1" {
        if let Ok(ip) = local_ip_address::local_ip() {
            best_ip = ip.to_string();
            best_interface = "Default Adapter".to_string();
        }
    }

    if let Ok(mut ip_lock) = BEST_IP.write() {
        *ip_lock = best_ip.clone();
    }
    if let Ok(mut iface_lock) = BEST_IFACE.write() {
        *iface_lock = best_interface.clone();
    }

    app.emit("my-ip", best_ip.clone()).unwrap_or(());
    let app_clone = app.clone();

    let my_ip_filter = best_ip.clone();
    
    // Thread 1: Mendengarkan Radar (Beacon) dari aplikasi NetSim lain
    thread::spawn(move || {
        let mut buf = [0; 2048];
        loop {
            if let Ok((size, _src)) = listener.recv_from(&mut buf) {
                if let Ok(payload_str) = std::str::from_utf8(&buf[..size]) {
                    if let Ok(mut payload) = serde_json::from_str::<PeerPayload>(payload_str) {
                        // Saring agar tidak mendeteksi diri sendiri
                        if payload.ip != my_ip_filter {
                            payload.is_app = true;
                            app_clone.emit("peer-discovered", payload).unwrap_or(());
                        }
                    }
                }
            }
            thread::sleep(Duration::from_millis(100));
        }
    });

    let alert_app = app.clone();
    
    // Thread 2: Mendengarkan Pesan Alert / Chat Masuk di port 8889
    thread::spawn(move || {
        if let Ok(alert_listener) = UdpSocket::bind("0.0.0.0:8889") {
            let mut buf = [0; 8192];
            let mut recent_ids: std::collections::VecDeque<(String, std::time::Instant)> = std::collections::VecDeque::new();

            loop {
                if let Ok((size, src)) = alert_listener.recv_from(&mut buf) {
                    if let Ok(payload_str) = std::str::from_utf8(&buf[..size]) {
                        if let Ok(mut payload) = serde_json::from_str::<AlertPayload>(payload_str) {
                            let now = std::time::Instant::now();
                            // Bersihkan ID yang lebih dari 10 detik lalu
                            while let Some((_, time)) = recent_ids.front() {
                                if now.duration_since(*time) > Duration::from_secs(10) {
                                    recent_ids.pop_front();
                                } else {
                                    break;
                                }
                            }

                            // Jika ID sudah pernah diterima sebelumnya, abaikan duplikat jaringan!
                            if !payload.id.is_empty() {
                                if recent_ids.iter().any(|(id, _)| id == &payload.id) {
                                    continue;
                                }
                                recent_ids.push_back((payload.id.clone(), now));
                            }

                            payload.sender_ip = Some(src.ip().to_string());
                            alert_app.emit("incoming-alert", payload).unwrap_or(());
                        }
                    }
                }
                thread::sleep(Duration::from_millis(50));
            }
        }
    });

    let my_ip_for_broadcast = best_ip.clone();
    let my_interface_for_broadcast = best_interface.clone();

    // Thread 3: Memancarkan Radar Beacon NetSim secara dinamis
    thread::spawn(move || {
        let broadcaster = UdpSocket::bind(format!("{}:0", my_ip_for_broadcast))
            .unwrap_or_else(|_| UdpSocket::bind("0.0.0.0:0").unwrap());
        
        let _ = broadcaster.set_broadcast(true);

        loop {
            let current_name = CURRENT_NAME.read().map(|n| n.clone()).unwrap_or_else(|_| "Siswa".to_string());
            let current_role = CURRENT_ROLE.read().map(|r| r.clone()).unwrap_or_else(|_| "student".to_string());

            let payload = PeerPayload {
                name: current_name,
                role: current_role,
                ip: my_ip_for_broadcast.clone(),
                interface: my_interface_for_broadcast.clone(),
                is_app: true,
            };
            
            if let Ok(payload_bytes) = serde_json::to_string(&payload) {
                // 1. Global broadcast
                let _ = broadcaster.send_to(payload_bytes.as_bytes(), format!("255.255.255.255:{}", port));
                
                // 2. Subnet broadcast
                if let Some(idx) = my_ip_for_broadcast.rfind('.') {
                    let subnet_broadcast = format!("{}.255:{}", &my_ip_for_broadcast[..idx], port);
                    let _ = broadcaster.send_to(payload_bytes.as_bytes(), subnet_broadcast);
                }

                // 3. Subnet broadcast ke semua interface fisik
                if let Ok(interfaces) = local_ip_address::list_afinet_netifas() {
                    for (_name, if_ip) in interfaces.iter() {
                        let if_str = if_ip.to_string();
                        if if_ip.is_ipv4() && !if_str.starts_with("127.") && !if_str.starts_with("169.254.") {
                            if let Some(idx) = if_str.rfind('.') {
                                let _ = broadcaster.send_to(payload_bytes.as_bytes(), format!("{}.255:{}", &if_str[..idx], port));
                            }
                        }
                    }
                }
            }

            thread::sleep(Duration::from_secs(2));
        }
    });

    // Thread 4: Pemindai Jaringan Nyata LAN (ARP & Probe Sweep)
    let arp_app = app.clone();
    let my_ip_for_arp = best_ip.clone();

    thread::spawn(move || {
        let base_subnet = if let Some(idx) = my_ip_for_arp.rfind('.') {
            my_ip_for_arp[..idx].to_string()
        } else {
            "192.168.88".to_string()
        };

        loop {
            // Trigger kernel ARP cache refresh dengan probe ringan ke seluruh subnet
            if let Ok(socket) = UdpSocket::bind("0.0.0.0:0") {
                for host in 1..=254 {
                    let target = format!("{}.{}:8888", base_subnet, host);
                    let _ = socket.send_to(b"radar-probe", target);
                }
            }
            
            thread::sleep(Duration::from_millis(500));

            // Baca tabel ARP Windows
            let mut arp_cmd = Command::new("arp");
            arp_cmd.arg("-a");
            #[cfg(target_os = "windows")]
            arp_cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW

            if let Ok(output) = arp_cmd.output() {
                let text = String::from_utf8_lossy(&output.stdout);
                for line in text.lines() {
                    let parts: Vec<&str> = line.split_whitespace().collect();
                    if parts.len() >= 3 {
                        let ip_str = parts[0];
                        let mac_str = parts[1];
                        
                        if let Ok(ip) = ip_str.parse::<std::net::Ipv4Addr>() {
                            let octets = ip.octets();
                            // Abaikan multicast, broadcast, loopback, dan IP mesin sendiri
                            if octets[0] >= 224 || octets[3] == 255 || octets[0] == 127 || ip_str == my_ip_for_arp {
                                continue;
                            }
                            if mac_str.contains("ff-ff-ff-ff-ff-ff") {
                                continue;
                            }
                            
                            let is_gateway = octets[3] == 1;
                            let peer_name = if is_gateway {
                                "Router / Gateway".to_string()
                            } else {
                                format!("Node-{}", octets[3])
                            };
                            
                            let peer_role = if is_gateway {
                                "teacher".to_string()
                            } else {
                                "student".to_string()
                            };

                            let payload = PeerPayload {
                                name: peer_name,
                                role: peer_role,
                                ip: ip_str.to_string(),
                                interface: format!("MAC: {}", mac_str),
                                is_app: false,
                            };

                            let _ = arp_app.emit("peer-discovered", payload);
                        }
                    }
                }
            }

            thread::sleep(Duration::from_secs(5));
        }
    });

    Ok("Radar, Alert Listener, and LAN Scanner started".to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  start_http_file_server();
  tauri::Builder::default()
    .invoke_handler(tauri::generate_handler![
        start_radar, 
        execute_ping, 
        send_alert, 
        broadcast_chat, 
        update_node_name,
        register_file_for_sharing,
        save_file_to_downloads
    ])
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while building tauri application");
}
