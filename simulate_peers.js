import dgram from 'dgram';
const client = dgram.createSocket('udp4');

const port = 8888;

// Data perangkat virtual
const dummyPeers = [
  { name: "Siswa-PC-01", role: "student", ip: "10.10.22.101", interface: "Simulasi Virtual" },
  { name: "Siswa-PC-02", role: "student", ip: "10.10.22.102", interface: "Simulasi Virtual" },
  { name: "Guru-Lain", role: "teacher", ip: "10.10.22.50", interface: "Simulasi Virtual" }
];

client.bind(() => {
    client.setBroadcast(true);
    console.log("📡 Simulator UDP aktif! Menyiarkan 3 perangkat dummy...");
    console.log("Biarkan script ini berjalan. Tekan Ctrl+C untuk menghentikan.");
    
    // Broadcast data secara berulang setiap 2 detik
    setInterval(() => {
        dummyPeers.forEach(peer => {
            const message = Buffer.from(JSON.stringify(peer));
            // Kirim ke 127.0.0.1 (localhost) agar ditangkap oleh aplikasi Tauri Anda yang mendengarkan 0.0.0.0
            client.send(message, 0, message.length, port, "127.0.0.1", (err) => {
                if (err) console.error("Error mengirim beacon:", err);
            });
        });
    }, 2000);
});
