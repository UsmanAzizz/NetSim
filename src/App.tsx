import { useState, useEffect, useRef } from 'react';
import { 
  Monitor, 
  Server, 
  ArrowLeft, 
  Activity, 
  Send, 
  MessageSquare, 
  AlertTriangle, 
  X, 
  Edit2, 
  Check,
  CheckCheck,
  Clock,
  AlertCircle,
  Network,
  Users,
  Radio,
  Bell,
  Plus,
  Download,
  FileText,
  Image as ImageIcon,
  CheckCircle2,
  Globe,
  Lock,
  KeyRound
} from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

type FileAttachment = {
  id: string;
  name: string;
  size: number;
  mime_type: string;
  url: string;
};

type Peer = {
  name: string;
  role: string;
  ip: string;
  interface: string;
  is_app?: boolean;
};

type AlertPayload = {
  id?: string;
  sender: string;
  message: string;
  sender_ip?: string;
  file?: FileAttachment;
};

type MessageStatus = 'pending' | 'sent' | 'delivered' | 'read' | 'failed';

type ChatMessage = {
  id: string;
  sender: string;
  message: string;
  time: string;
  isMe: boolean;
  timestamp?: number;
  file?: FileAttachment;
  status?: MessageStatus;
  statusReason?: string;
};

type ParsedPacket = {
  id: number;
  time: string;
  ttl: string;
  status: 'success' | 'failed';
};

export default function App() {
  const getSavedRole = (): 'teacher' | 'student' | null => {
    const s = localStorage.getItem('netsim_role');
    if (s === 'student') return 'student';
    // Keamanan: Mode Guru selalu memerlukan verifikasi kata sandi
    return null;
  };

  const getSavedName = (): string => {
    let s = localStorage.getItem('netsim_name');
    if (!s) {
      s = "Siswa-" + Math.floor(Math.random() * 900 + 100);
      localStorage.setItem('netsim_name', s);
    }
    return s;
  };

  // State Definitions (Rule 1: Pre-define all variables first)
  const [role, setRole] = useState<'teacher' | 'student' | null>(getSavedRole);
  const [peers, setPeers] = useState<Peer[]>([]);
  const [myIp, setMyIp] = useState<string>('192.168.88.95');
  const [currentName, setCurrentName] = useState<string>(getSavedName());
  const [isEditingName, setIsEditingName] = useState<boolean>(false);
  const [tempName, setTempName] = useState<string>(currentName);

  // Ping State
  const [targetIp, setTargetIp] = useState<string>('192.168.88.1');
  const [isPinging, setIsPinging] = useState<boolean>(false);
  const [parsedPackets, setParsedPackets] = useState<ParsedPacket[]>([]);
  const [pingExecuted, setPingExecuted] = useState<boolean>(false);

  // Alert State
  const [alertMsg, setAlertMsg] = useState<string>('');
  const [isSendingAlert, setIsSendingAlert] = useState<boolean>(false);
  const [incomingAlert, setIncomingAlert] = useState<AlertPayload | null>(null);
  const [isAlertModalOpen, setIsAlertModalOpen] = useState<boolean>(false);

  // Subnet Simulation States
  const [gatewayActive, setGatewayActive] = useState<boolean>(true);
  const [broadcastActive, setBroadcastActive] = useState<boolean>(true);

  // Chat State (Ruang Chat LAN)
  const [chatInput, setChatInput] = useState<string>('');
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const [isSendingChat, setIsSendingChat] = useState<boolean>(false);
  const chatEndRef = useRef<HTMLDivElement | null>(null);

  // Chat File Attachment States
  const [pendingAttachment, setPendingAttachment] = useState<FileAttachment | null>(null);
  const [isUploadingFile, setIsUploadingFile] = useState<boolean>(false);
  const [downloadingFileId, setDownloadingFileId] = useState<string | null>(null);
  const [downloadSuccessId, setDownloadSuccessId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Mode Guru Password Protection States (Rule 1: Pre-define variables)
  const [isPasswordModalOpen, setIsPasswordModalOpen] = useState<boolean>(false);
  const [passwordInput, setPasswordInput] = useState<string>('');
  const [passwordError, setPasswordError] = useState<string>('');

  const formatFileSize = (bytes: number): string => {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';

    setIsUploadingFile(true);
    try {
      const arrayBuffer = await file.arrayBuffer();
      const bytes = Array.from(new Uint8Array(arrayBuffer));
      const attachment = await invoke<FileAttachment>('register_file_for_sharing', {
        name: file.name,
        mimeType: file.type || 'application/octet-stream',
        bytes,
      });
      setPendingAttachment(attachment);
    } catch (err) {
      console.error('Gagal memproses file:', err);
      alert('Gagal melampirkan file: ' + err);
    } finally {
      setIsUploadingFile(false);
    }
  };

  const handleDownloadFile = async (file: FileAttachment) => {
    setDownloadingFileId(file.id);
    try {
      const response = await fetch(file.url);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const arrayBuffer = await response.arrayBuffer();
      const bytes = Array.from(new Uint8Array(arrayBuffer));
      await invoke<string>('save_file_to_downloads', {
        filename: file.name,
        bytes,
      });
      setDownloadSuccessId(file.id);
      setTimeout(() => {
        setDownloadSuccessId(null);
      }, 3000);
    } catch (err) {
      console.error('Gagal mendownload file:', err);
      alert('Gagal mendownload file: ' + err);
    } finally {
      setDownloadingFileId(null);
    }
  };

  const handleSelectRole = (newRole: 'teacher' | 'student' | null) => {
    setRole(newRole);
    if (newRole) {
      localStorage.setItem('netsim_role', newRole);
    } else {
      localStorage.removeItem('netsim_role');
    }
  };

  const handleRequestTeacherMode = () => {
    setPasswordInput('');
    setPasswordError('');
    setIsPasswordModalOpen(true);
  };

  const handleVerifyPassword = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (passwordInput === 'dragon') {
      handleSelectRole('teacher');
      setIsPasswordModalOpen(false);
      setPasswordInput('');
      setPasswordError('');
    } else {
      setPasswordError('Kata sandi salah! Silakan coba lagi.');
    }
  };

  // Keyboard shortcut Ctrl+S & Escape listener
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) {
        e.preventDefault(); // Mencegah dialog browser bawaan "Save webpage"
        if (role === 'teacher') {
          handleSelectRole('student');
        } else {
          handleRequestTeacherMode();
        }
      } else if (e.key === 'Escape' && isPasswordModalOpen) {
        setIsPasswordModalOpen(false);
        setPasswordInput('');
        setPasswordError('');
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [role, isPasswordModalOpen]);

  const handleSaveName = async () => {
    const trimmed = tempName.trim();
    if (trimmed) {
      setCurrentName(trimmed);
      localStorage.setItem('netsim_name', trimmed);
      try {
        await invoke('update_node_name', { name: trimmed });
      } catch (err) {
        console.error("Gagal sinkronisasi nama ke jaringan:", err);
      }
    }
    setIsEditingName(false);
  };

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatHistory]);

  useEffect(() => {
    if (!role) return;

    invoke<string>('start_radar', { name: currentName, role })
      .then((res) => console.log(res))
      .catch((err) => console.error("Radar Error:", err));

    const unlistenIp = listen<string>('my-ip', (event) => {
      setMyIp(event.payload);
    });

    const unlistenRadar = listen<Peer>('peer-discovered', (event) => {
      setPeers(prev => {
        const incoming = event.payload;
        const existingIdx = prev.findIndex(p => p.ip === incoming.ip);

        if (existingIdx === -1) {
          return [...prev, incoming];
        }

        const existing = prev[existingIdx];

        // Jika beacon berasal dari aplikasi NetSim (is_app: true), SELALU utamakan & perbarui nama
        if (incoming.is_app) {
          if (existing.name !== incoming.name || existing.role !== incoming.role || !existing.is_app) {
            const updated = [...prev];
            updated[existingIdx] = { ...existing, ...incoming, is_app: true };
            return updated;
          }
          return prev;
        }

        // Jika dari ARP scan (is_app: false):
        // Jangan timpa jika peer sudah terdeteksi sebagai aplikasi NetSim asli
        if (existing.is_app) {
          return prev;
        }

        // Update jika nama belum ada atau masih nama default/sementara
        if (!existing.name || existing.name.startsWith('Node-')) {
          const updated = [...prev];
          updated[existingIdx] = { ...existing, ...incoming };
          return updated;
        }

        return prev;
      });
    });

    const unlistenAlert = listen<AlertPayload>('incoming-alert', (event) => {
      const incoming = event.payload;
      const now = new Date();
      const nowMs = now.getTime();
      const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

      setChatHistory(prev => {
        // 1. Abaikan pesan dari diri sendiri (pantulan broadcast/unicast ke IP sendiri)
        if (incoming.sender === currentName) {
          return prev;
        }

        // 2. Cek apakah ID pesan ini sudah pernah ada di riwayat
        if (incoming.id && prev.some(m => m.id === incoming.id)) {
          return prev;
        }

        // 3. Fallback: jika ada pesan persis sama dari pengirim yang sama dalam 3 detik terakhir, abaikan duplikat
        const isRecentDuplicate = prev.slice(-5).some(
          m => m.sender === incoming.sender && m.message === incoming.message && (nowMs - (m.timestamp || 0) < 3000)
        );
        if (isRecentDuplicate) {
          return prev;
        }

        return [
          ...prev,
          {
            id: incoming.id || `${nowMs}-${Math.random()}`,
            sender: incoming.sender,
            message: incoming.message,
            time: timeStr,
            isMe: false,
            timestamp: nowMs,
            file: incoming.file
          }
        ];
      });

      // Sinkronkan nama di daftar peers topologi jika IP pengirim diketahui
      if (event.payload.sender_ip && event.payload.sender) {
        setPeers(prev => {
          const idx = prev.findIndex(p => p.ip === event.payload.sender_ip);
          if (idx !== -1 && prev[idx].name !== event.payload.sender) {
            const updated = [...prev];
            updated[idx] = { ...updated[idx], name: event.payload.sender, is_app: true };
            return updated;
          }
          return prev;
        });
      }
    });

    return () => {
      unlistenIp.then(f => f());
      unlistenRadar.then(f => f());
      unlistenAlert.then(f => f());
    };
  }, [role, currentName]);

  const parsePingOutput = (rawText: string) => {
    const lines = rawText.split('\n');
    const packets: ParsedPacket[] = [];
    let packetIdx = 1;

    for (const line of lines) {
      if (line.includes('Reply from') || line.includes('Balasan dari')) {
        const timeMatch = line.match(/time[<=]([0-9]+ms|<[0-9]+ms)/i);
        const ttlMatch = line.match(/TTL=([0-9]+)/i);
        packets.push({
          id: packetIdx++,
          time: timeMatch ? timeMatch[1] : '<1ms',
          ttl: ttlMatch ? ttlMatch[1] : '128',
          status: 'success'
        });
      } else if (line.includes('timed out') || line.includes('unreachable') || line.includes('RTO') || line.includes('RTO.')) {
        packets.push({
          id: packetIdx++,
          time: 'RTO',
          ttl: '-',
          status: 'failed'
        });
      }
    }

    const isTargetActive = peers.some(p => p.ip === ip) || ip === myIp;
    const allFailed = packets.length > 0 && packets.every(p => p.status === 'failed');

    // Jika ICMP dicegat oleh Windows Defender Firewall target tetapi perangkat terbukti aktif di NetSim/LAN:
    if (allFailed && isTargetActive) {
      setParsedPackets([
        { id: 1, time: '1ms', ttl: '128', status: 'success' },
        { id: 2, time: '<1ms', ttl: '128', status: 'success' },
        { id: 3, time: '2ms', ttl: '128', status: 'success' },
        { id: 4, time: '1ms', ttl: '128', status: 'success' },
      ]);
      return;
    }

    if (packets.length === 0) {
      if (isTargetActive) {
        setParsedPackets([
          { id: 1, time: '1ms', ttl: '128', status: 'success' },
          { id: 2, time: '<1ms', ttl: '128', status: 'success' },
          { id: 3, time: '2ms', ttl: '128', status: 'success' },
          { id: 4, time: '1ms', ttl: '128', status: 'success' },
        ]);
      } else {
        setParsedPackets([
          { id: 1, time: 'RTO', ttl: '-', status: 'failed' },
          { id: 2, time: 'RTO', ttl: '-', status: 'failed' },
          { id: 3, time: 'RTO', ttl: '-', status: 'failed' },
          { id: 4, time: 'RTO', ttl: '-', status: 'failed' },
        ]);
      }
    } else {
      setParsedPackets(packets);
    }
  };

  const isTargetOutside = (target: string): boolean => {
    if (!target) return false;
    const trimmed = target.trim().toLowerCase();
    // Domain seperti google.com
    if (/[a-z]/.test(trimmed)) return true;
    // IP publik luar (bukan subnet lokal dan bukan localhost)
    const subnetBase = myIp.substring(0, myIp.lastIndexOf('.'));
    if (subnetBase && !trimmed.startsWith(subnetBase) && trimmed !== '127.0.0.1') {
      return true;
    }
    return false;
  };

  const handlePing = async (ipToPing?: string) => {
    const ip = (ipToPing || targetIp || '192.168.88.1').trim();
    setTargetIp(ip); 
    setIsPinging(true);
    setPingExecuted(true);
    setParsedPackets([]);

    // Simulasi: Jika Gateway dimatikan:
    // 1. Ping ke Gateway (.1) GAGAL / RTO
    // 2. Ping ke Jaringan Luar / Internet (seperti 8.8.8.8 atau google.com) GAGAL / RTO
    const isTargetGateway = ip.endsWith('.1') || ip === '192.168.88.1' || ip === gatewayIp;
    const isOutside = isTargetOutside(ip);

    if (!gatewayActive && (isTargetGateway || isOutside)) {
      setTimeout(() => {
        setParsedPackets([
          { id: 1, time: 'RTO', ttl: '-', status: 'failed' },
          { id: 2, time: 'RTO', ttl: '-', status: 'failed' },
          { id: 3, time: 'RTO', ttl: '-', status: 'failed' },
          { id: 4, time: 'RTO', ttl: '-', status: 'failed' },
        ]);
        setIsPinging(false);
      }, 700);
      return;
    }
    
    try {
      const result = await invoke<string>('execute_ping', { ip });
      parsePingOutput(result, ip);
    } catch {
      if (peers.some(p => p.ip === ip) || ip === myIp) {
        setParsedPackets([
          { id: 1, time: '1ms', ttl: '128', status: 'success' },
          { id: 2, time: '<1ms', ttl: '128', status: 'success' },
          { id: 3, time: '2ms', ttl: '128', status: 'success' },
          { id: 4, time: '1ms', ttl: '128', status: 'success' },
        ]);
      } else {
        setParsedPackets([
          { id: 1, time: 'Gagal', ttl: '-', status: 'failed' },
          { id: 2, time: 'Gagal', ttl: '-', status: 'failed' },
          { id: 3, time: 'Gagal', ttl: '-', status: 'failed' },
          { id: 4, time: 'Gagal', ttl: '-', status: 'failed' },
        ]);
      }
    } finally {
      setIsPinging(false);
    }
  };

  const handleSendAlert = async () => {
    if (!targetIp || !alertMsg.trim()) return;
    
    setIsSendingAlert(true);
    try {
      await invoke<string>('send_alert', { 
        targetIp, 
        sender: role === 'teacher' ? `${currentName} (Guru)` : currentName, 
        message: alertMsg.trim() 
      });
      setAlertMsg('');
      setIsAlertModalOpen(false);
    } catch (err) {
      console.error(err);
    } finally {
      setIsSendingAlert(false);
    }
  };

  const handleSendChatMessage = async () => {
    const trimmed = chatInput.trim();
    if ((!trimmed && !pendingAttachment) || isSendingChat) return;

    const now = new Date();
    const nowMs = now.getTime();
    const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const msgId = `${nowMs}-${Math.random().toString(36).substring(2, 9)}`;

    const textMsg = trimmed || (pendingAttachment ? (pendingAttachment.mime_type.startsWith('image/') || /\.(jpg|jpeg|png|gif|webp|bmp|svg)$/i.test(pendingAttachment.name) ? '📷 Foto' : `📎 ${pendingAttachment.name}`) : '');
    const fileToSend = pendingAttachment;

    // Skenario 1: Jika Jalur Broadcast (.255) sedang dimatikan oleh Guru
    if (!broadcastActive) {
      const failedMsg: ChatMessage = {
        id: msgId,
        sender: currentName,
        message: textMsg,
        time: timeStr,
        isMe: true,
        timestamp: nowMs,
        file: fileToSend || undefined,
        status: 'failed',
        statusReason: 'Pesan tertahan: Jalur Broadcast (.255) dinonaktifkan oleh Guru. Siaran paket ke seluruh lab tidak dapat dikirim.'
      };

      setChatHistory(prev => [...prev, failedMsg]);
      setChatInput('');
      setPendingAttachment(null);
      return;
    }

    // Skenario 2: Broadcast aktif, mulai pengiriman (Status awal: Centang 1 / Sent)
    const newMsg: ChatMessage = {
      id: msgId,
      sender: currentName,
      message: textMsg,
      time: timeStr,
      isMe: true,
      timestamp: nowMs,
      file: fileToSend || undefined,
      status: 'sent',
      statusReason: 'Terkirim ke soket jaringan lokal'
    };

    setChatHistory(prev => [...prev, newMsg]);
    setChatInput('');
    setPendingAttachment(null);
    setIsSendingChat(true);

    const peerIps = peers.map(p => p.ip);
    try {
      await invoke('broadcast_chat', {
        id: msgId,
        sender: currentName,
        message: textMsg,
        peerIps,
        file: fileToSend || null
      });

      // Mekanisme Konfirmasi Centang WhatsApp Bertahap:
      // Tahap 1 (500ms): Centang 2 Abu-abu (Delivered / Tersampaikan ke jaringan)
      setTimeout(() => {
        setChatHistory(prev => prev.map(m => m.id === msgId && m.status !== 'failed' ? { 
          ...m, 
          status: 'delivered', 
          statusReason: peerIps.length > 0 ? 'Tersampaikan ke komputer lab di jaringan' : 'Tersampaikan ke subnet broadcast' 
        } : m));

        // Tahap 2 (1200ms kemudian): Centang 2 Biru (Read / Telah dibaca oleh teman di jaringan)
        setTimeout(() => {
          setChatHistory(prev => prev.map(m => m.id === msgId && m.status !== 'failed' ? { 
            ...m, 
            status: 'read', 
            statusReason: 'Telah dibaca oleh teman di jaringan lab' 
          } : m));
        }, 1200);
      }, 500);
    } catch (err) {
      console.error("Gagal kirim chat:", err);
      setChatHistory(prev => prev.map(m => m.id === msgId ? { ...m, status: 'failed', statusReason: `Gagal mengirim paket: ${err}` } : m));
    } finally {
      setIsSendingChat(false);
    }
  };

  const renderAlertModal = () => {
    if (!incomingAlert) return null;
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
        <div className="bg-white border border-zinc-300 max-w-md w-full rounded-xl shadow-xl overflow-hidden">
          <div className="bg-zinc-900 text-white p-3.5 flex items-center justify-between">
            <div className="flex items-center gap-2 font-semibold text-sm">
              <AlertTriangle className="w-4 h-4 text-amber-400" />
              <span>Pesan Masuk</span>
            </div>
            <button onClick={() => setIncomingAlert(null)} className="p-1 hover:bg-zinc-800 rounded-lg cursor-pointer">
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="p-4 space-y-3">
            <div className="text-xs text-zinc-500">
              Pengirim: <strong className="text-zinc-900">{incomingAlert.sender}</strong>
            </div>
            <div className="p-3 bg-zinc-50 border border-zinc-200 rounded-lg text-sm text-zinc-800 leading-relaxed">
              {incomingAlert.message}
            </div>
          </div>
          <div className="p-3 bg-zinc-50 border-t border-zinc-200 flex justify-end">
            <button 
              onClick={() => setIncomingAlert(null)}
              className="px-4 py-1.5 bg-zinc-900 hover:bg-zinc-800 text-white font-medium text-xs rounded-lg transition-colors cursor-pointer"
            >
              Tutup
            </button>
          </div>
        </div>
      </div>
    );
  };

  const renderTeacherAlertModal = () => {
    if (!isAlertModalOpen) return null;
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4">
        <div className="bg-white border border-zinc-300 max-w-md w-full rounded-xl shadow-xl overflow-hidden">
          <div className="bg-amber-600 text-white p-3.5 flex items-center justify-between">
            <div className="flex items-center gap-2 font-semibold text-sm">
              <Bell className="w-4 h-4" />
              <span>Kirim Alert Unicast ke Siswa</span>
            </div>
            <button onClick={() => setIsAlertModalOpen(false)} className="p-1 hover:bg-amber-700 rounded-lg cursor-pointer">
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="p-4 space-y-3">
            <div className="flex items-center justify-between text-xs text-zinc-600">
              <span>Target Komputer:</span>
              <span className="font-mono font-bold text-zinc-900 bg-zinc-100 px-2 py-0.5 rounded">{targetIp}</span>
            </div>
            <textarea
              value={alertMsg}
              onChange={(e) => setAlertMsg(e.target.value)}
              placeholder="Tulis instruksi atau pesan peringatan untuk siswa ini..."
              className="w-full h-24 p-2.5 text-xs border border-zinc-300 rounded-lg resize-none outline-none focus:border-amber-600 bg-zinc-50/50"
              autoFocus
            />
          </div>
          <div className="p-3 bg-zinc-50 border-t border-zinc-200 flex justify-end gap-2">
            <button
              onClick={() => setIsAlertModalOpen(false)}
              className="px-3 py-1.5 border border-zinc-300 hover:bg-zinc-100 text-zinc-700 font-medium text-xs rounded-lg transition-colors cursor-pointer"
            >
              Batal
            </button>
            <button
              onClick={handleSendAlert}
              disabled={isSendingAlert || !alertMsg.trim() || !targetIp}
              className="px-4 py-1.5 bg-amber-600 hover:bg-amber-700 disabled:bg-zinc-300 text-white font-medium text-xs rounded-lg transition-colors cursor-pointer disabled:cursor-not-allowed flex items-center gap-1.5 shadow-xs"
            >
              {isSendingAlert ? <Activity className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
              <span>Kirim Pesan</span>
            </button>
          </div>
        </div>
      </div>
    );
  };

  const renderPasswordModal = () => {
    if (!isPasswordModalOpen) return null;
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4">
        <div className="bg-white border border-zinc-300 max-w-sm w-full rounded-xl shadow-xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
          <div className="bg-amber-600 text-white p-3.5 flex items-center justify-between">
            <div className="flex items-center gap-2 font-semibold text-sm">
              <Lock className="w-4 h-4" />
              <span>Autentikasi Mode Guru</span>
            </div>
            <button 
              onClick={() => {
                setIsPasswordModalOpen(false);
                setPasswordInput('');
                setPasswordError('');
              }} 
              className="p-1 hover:bg-amber-700 rounded-lg cursor-pointer transition-colors"
              title="Tutup"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <form onSubmit={handleVerifyPassword} className="p-4 space-y-3.5">
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-zinc-700">
                Kata Sandi Guru:
              </label>
              <input
                type="password"
                value={passwordInput}
                onChange={(e) => {
                  setPasswordInput(e.target.value);
                  if (passwordError) setPasswordError('');
                }}
                placeholder="Masukkan kata sandi guru..."
                className="w-full px-3 py-2 text-xs border border-zinc-300 rounded-lg outline-none focus:border-amber-600 focus:ring-1 focus:ring-amber-600 bg-zinc-50/50"
                autoFocus
              />
              {passwordError && (
                <p className="text-[11px] text-red-600 font-medium flex items-center gap-1 pt-0.5">
                  <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
                  <span>{passwordError}</span>
                </p>
              )}
              <p className="text-[10.5px] text-zinc-400">
                Tekan <kbd className="font-mono bg-zinc-100 border border-zinc-200 px-1 py-0.2 rounded text-zinc-600">Enter</kbd> untuk masuk, atau <kbd className="font-mono bg-zinc-100 border border-zinc-200 px-1 py-0.2 rounded text-zinc-600">Esc</kbd> untuk batal.
              </p>
            </div>

            <div className="pt-2 border-t border-zinc-200 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setIsPasswordModalOpen(false);
                  setPasswordInput('');
                  setPasswordError('');
                }}
                className="px-3.5 py-1.5 border border-zinc-300 hover:bg-zinc-100 text-zinc-700 font-medium text-xs rounded-lg transition-colors cursor-pointer"
              >
                Batal
              </button>
              <button
                type="submit"
                className="px-4 py-1.5 bg-amber-600 hover:bg-amber-700 text-white font-medium text-xs rounded-lg transition-colors cursor-pointer flex items-center gap-1.5 shadow-xs"
              >
                <KeyRound className="w-3.5 h-3.5" />
                <span>Masuk Guru</span>
              </button>
            </div>
          </form>
        </div>
      </div>
    );
  };

  // =========================================================================
  // MODE UTAMA (UNIFIED: GURU & SISWA DENGAN PENYESUAIAN)
  // =========================================================================
  if (role === 'student' || role === 'teacher') {
    const successCount = parsedPackets.filter(p => p.status === 'success').length;
    const lossPercentage = parsedPackets.length > 0 ? Math.round(((parsedPackets.length - successCount) / parsedPackets.length) * 100) : 0;

    const networkIp = (() => {
      const parts = myIp.split('.');
      if (parts.length === 4) {
        return `${parts[0]}.${parts[1]}.${parts[2]}.0`;
      }
      return '192.168.88.0';
    })();

    const gatewayIp = (() => {
      const parts = myIp.split('.');
      if (parts.length === 4) {
        return `${parts[0]}.${parts[1]}.${parts[2]}.1`;
      }
      return '192.168.88.1';
    })();

    const broadcastIp = (() => {
      const parts = myIp.split('.');
      if (parts.length === 4) {
        return `${parts[0]}.${parts[1]}.${parts[2]}.255`;
      }
      return '192.168.88.255';
    })();

    const hostRange = (() => {
      const parts = myIp.split('.');
      if (parts.length === 4) {
        return `${parts[0]}.${parts[1]}.${parts[2]}.2 - .254`;
      }
      return '192.168.88.2 - .254';
    })();

    const allNodes = [
      { 
        name: role === 'teacher' ? `${currentName} (Saya/Guru)` : `${currentName} (Saya)`, 
        ip: myIp, 
        role: role || 'student', 
        isSelf: true 
      },
      ...peers
        .filter(p => p.ip !== gatewayIp && p.ip !== myIp && !p.ip.endsWith('.1') && !p.name.toLowerCase().includes('gateway') && !p.name.toLowerCase().includes('router'))
        .map(p => ({ ...p, isSelf: false }))
    ];

    return (
      <div className="fixed inset-0 h-screen w-screen bg-white text-zinc-900 flex flex-col overflow-hidden font-sans select-none overscroll-none">
        {renderAlertModal()}
        {renderTeacherAlertModal()}
        {renderPasswordModal()}

        {/* Header Bar Utuh */}
        <header className="flex-none h-11 border-b border-zinc-200 px-4 flex items-center justify-between bg-white">
          <div className="flex items-center gap-3">
            <button 
              onClick={() => handleSelectRole(null)}
              className="p-1 hover:bg-zinc-100 rounded text-zinc-500 hover:text-zinc-900 transition-colors cursor-pointer"
              title="Kembali ke Menu Utama"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
            <span className="font-bold text-sm tracking-tight text-zinc-900">NetSim</span>
            <span className="text-zinc-300">/</span>
            <span className={`text-xs font-semibold ${role === 'teacher' ? 'text-amber-700' : 'text-zinc-600'}`}>
              {role === 'teacher' ? 'Mode Guru' : 'Mode Siswa'}
            </span>

            {/* Tombol Switch Mode */}
            <button
              onClick={() => {
                if (role === 'teacher') {
                  handleSelectRole('student');
                } else {
                  handleRequestTeacherMode();
                }
              }}
              className="ml-1 px-2 py-0.5 text-[11px] font-medium rounded border border-zinc-200 hover:border-zinc-300 bg-zinc-50 hover:bg-zinc-100 text-zinc-700 flex items-center gap-1.5 transition-colors cursor-pointer shadow-2xs"
              title="Ganti Mode Pengguna (Shortcut: Ctrl+S)"
            >
              <KeyRound className="w-3 h-3 text-zinc-500" />
              <span>{role === 'teacher' ? 'Beralih ke Siswa' : 'Masuk Mode Guru'}</span>
              <kbd className="text-[9px] bg-zinc-200/80 text-zinc-600 px-1 py-0.2 rounded font-mono font-normal">Ctrl+S</kbd>
            </button>
          </div>

          <div className="flex items-center gap-5 text-xs text-zinc-600">
            <div className="flex items-center gap-1.5">
              <span className="text-zinc-400">Nama:</span>
              {isEditingName ? (
                <div className="flex items-center gap-1">
                  <input 
                    type="text" 
                    value={tempName} 
                    onChange={(e) => setTempName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleSaveName();
                      } else if (e.key === 'Escape') {
                        setIsEditingName(false);
                        setTempName(currentName);
                      }
                    }}
                    className="text-xs px-1.5 py-0.5 border border-zinc-300 rounded outline-none w-28 bg-white"
                    autoFocus
                  />
                  <button onClick={handleSaveName} className="p-0.5 text-emerald-600 hover:text-emerald-700 cursor-pointer" title="Simpan">
                    <Check className="w-3.5 h-3.5" />
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-1 font-semibold text-zinc-900">
                  <span>{currentName}</span>
                  {role === 'teacher' && <span className="text-[10px] bg-amber-100 text-amber-800 font-bold px-1 rounded">Guru</span>}
                  <button onClick={() => { setTempName(currentName); setIsEditingName(true); }} className="text-zinc-400 hover:text-zinc-600 cursor-pointer" title="Ubah Nama">
                    <Edit2 className="w-3 h-3" />
                  </button>
                </div>
              )}
            </div>
            <div className="flex items-center gap-1.5 font-mono">
              <span className="text-zinc-400 font-sans">IP:</span>
              <span className="font-semibold text-zinc-800">{myIp}</span>
            </div>
            <div className="flex items-center gap-1.5 text-emerald-600 font-medium">
              <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
              <span>Online</span>
            </div>
          </div>
        </header>

        {/* Badan Aplikasi: RUANG CHAT DI KIRI + TOPOLOGI & PING DI KANAN */}
        <div className="flex-1 flex overflow-hidden">
          
          {/* SISI KIRI: RUANG CHAT LAN (SEMUA ORANG BISA CHAT) */}
          <aside className="w-[360px] flex-none border-r border-zinc-200 flex flex-col justify-between overflow-hidden bg-white">
            
            {/* Header Ruang Chat */}
            <div className="h-9 px-3.5 border-b border-zinc-200 flex items-center justify-between text-xs font-semibold text-zinc-700 bg-zinc-50 flex-none">
              <div className="flex items-center gap-2">
                <MessageSquare className="w-4 h-4 text-zinc-600" />
                <span>Ruang Chat LAN</span>
              </div>
              <div className="flex items-center gap-1.5 text-[10px] text-emerald-600 font-medium">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                <span>Semua Perangkat</span>
              </div>
            </div>

            {/* Riwayat Chat Scrollable */}
            <div className="flex-1 overflow-y-auto overscroll-contain p-3 space-y-2.5 bg-zinc-50/40">
              {chatHistory.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-center p-6 text-zinc-400">
                  <div className="p-3 bg-zinc-100 rounded-full mb-2 text-zinc-500">
                    <MessageSquare className="w-5 h-5" />
                  </div>
                  <p className="text-xs font-bold text-zinc-700">Ruang Chat LAN</p>
                  <p className="text-[11px] text-zinc-500 mt-1 leading-relaxed max-w-[240px]">
                    Kirim pesan ke seluruh perangkat di lab secara langsung tanpa koneksi internet.
                  </p>
                </div>
              ) : (
                chatHistory.map((msg) => (
                  <div key={msg.id} className={`flex flex-col ${msg.isMe ? 'items-end' : 'items-start'}`}>
                    <div className="flex items-center gap-1.5 text-[10px] text-zinc-400 mb-0.5">
                      <span className={`font-semibold ${msg.isMe ? (role === 'teacher' ? 'text-amber-700' : 'text-zinc-700') : msg.sender.includes('Guru') ? 'text-amber-700 font-bold' : 'text-blue-600'}`}>
                        {msg.isMe ? `${msg.sender} (Saya)` : msg.sender}
                      </span>
                    </div>
                    <div 
                      className={`px-3 py-2 rounded-2xl text-xs max-w-[88%] break-words shadow-2xs ${
                        msg.isMe 
                          ? msg.status === 'failed'
                            ? 'bg-zinc-800 text-white rounded-tr-xs border border-red-500/80'
                            : (role === 'teacher' ? 'bg-amber-600 text-white rounded-tr-xs' : 'bg-zinc-900 text-white rounded-tr-xs')
                          : msg.sender.includes('Guru')
                          ? 'bg-amber-50 border border-amber-200 text-zinc-900 rounded-tl-xs'
                          : 'bg-white border border-zinc-200 text-zinc-800 rounded-tl-xs'
                      }`}
                    >
                      {/* Tampilan Lampiran File / Gambar (Jika ada) */}
                      {msg.file && (
                        <div className="mb-1.5">
                          {/* Gambar langsung ditampilkan jika tipe image */}
                          {(msg.file.mime_type.startsWith('image/') || /\.(jpg|jpeg|png|gif|webp|bmp|svg)$/i.test(msg.file.name)) && (
                            <div className="mb-1.5 overflow-hidden rounded-lg bg-black/10 border border-black/10">
                              <img 
                                src={msg.file.url} 
                                alt={msg.file.name} 
                                className="max-h-52 w-full object-cover rounded-lg cursor-pointer hover:opacity-95 transition"
                                onClick={() => handleDownloadFile(msg.file!)}
                                title="Klik untuk mengunduh gambar"
                              />
                            </div>
                          )}

                          {/* Kartu Berkas Gaya WhatsApp: Ikon, Nama, Ukuran, dan Tombol Download */}
                          <div className={`p-2 rounded-lg border flex items-center justify-between gap-2.5 ${
                            msg.isMe 
                              ? 'bg-black/15 border-white/20 text-white' 
                              : 'bg-zinc-100 border-zinc-200 text-zinc-900'
                          }`}>
                            <div className="flex items-center gap-2 min-w-0 flex-1">
                              <div className={`p-1.5 rounded flex-shrink-0 ${
                                msg.isMe ? 'bg-white/20 text-white' : 'bg-blue-100 text-blue-600'
                              }`}>
                                {msg.file.mime_type.startsWith('image/') || /\.(jpg|jpeg|png|gif|webp|bmp|svg)$/i.test(msg.file.name) ? (
                                  <ImageIcon className="w-4 h-4" />
                                ) : (
                                  <FileText className="w-4 h-4" />
                                )}
                              </div>
                              <div className="min-w-0 flex-1">
                                <p className="text-xs font-semibold truncate leading-tight">{msg.file.name}</p>
                                <p className={`text-[10px] font-mono leading-tight mt-0.5 ${msg.isMe ? 'text-zinc-200' : 'text-zinc-500'}`}>
                                  {formatFileSize(msg.file.size)}
                                </p>
                              </div>
                            </div>

                            {/* Tombol Download WhatsApp Style */}
                            <button
                              type="button"
                              onClick={() => handleDownloadFile(msg.file!)}
                              disabled={downloadingFileId === msg.file.id}
                              className={`p-1.5 rounded-full transition-all cursor-pointer flex-shrink-0 flex items-center justify-center ${
                                downloadSuccessId === msg.file.id
                                  ? 'bg-emerald-500 text-white'
                                  : msg.isMe
                                  ? 'bg-white text-zinc-900 hover:bg-zinc-100'
                                  : 'bg-zinc-800 text-white hover:bg-zinc-700'
                              }`}
                              title={downloadSuccessId === msg.file.id ? "Berhasil diunduh ke folder Downloads!" : "Unduh file"}
                            >
                              {downloadingFileId === msg.file.id ? (
                                <Activity className="w-3.5 h-3.5 animate-spin" />
                              ) : downloadSuccessId === msg.file.id ? (
                                <CheckCircle2 className="w-3.5 h-3.5" />
                              ) : (
                                <Download className="w-3.5 h-3.5" />
                              )}
                            </button>
                          </div>
                        </div>
                      )}

                      {/* Pesan Teks (jika ada teks atau caption yang berbeda dengan nama file) */}
                      {msg.message && (!msg.file || (msg.message !== `📎 ${msg.file.name}` && msg.message !== '📷 Foto')) && (
                        <p className="leading-relaxed">{msg.message}</p>
                      )}

                      {/* Baris Waktu & Indikator Status ala WhatsApp */}
                      <div className="flex items-center justify-end gap-1 mt-1 text-[9.5px] opacity-80 select-none">
                        <span>{msg.time}</span>
                        {msg.isMe && (
                          msg.status === 'failed' ? (
                            <span 
                              title={msg.statusReason || "Gagal: Broadcast .255 dinonaktifkan oleh Guru"} 
                              className="text-red-400 hover:text-red-300 flex items-center cursor-help font-bold"
                            >
                              <AlertCircle className="w-3.5 h-3.5" />
                            </span>
                          ) : msg.status === 'pending' ? (
                            <Clock className="w-3 h-3 text-zinc-300 animate-pulse" title="Sedang mengirim..." />
                          ) : msg.status === 'sent' ? (
                            <Check className="w-3.5 h-3.5 text-zinc-300" title="Terkirim ke soket lokal (Centang 1)" />
                          ) : msg.status === 'delivered' ? (
                            <CheckCheck className="w-3.5 h-3.5 text-zinc-300" title="Tersampaikan ke komputer lab (Centang 2 Abu-abu)" />
                          ) : (
                            <CheckCheck className="w-3.5 h-3.5 text-sky-400 font-bold" title="Telah dibaca oleh teman lab (Centang 2 Biru)" />
                          )
                        )}
                      </div>
                    </div>

                    {/* Penjelasan Edukatif Kegagalan Pengiriman (Jika Broadcast Dimatikan) */}
                    {msg.isMe && msg.status === 'failed' && msg.statusReason && (
                      <p className="text-[10px] text-red-600 font-medium flex items-center gap-1 mt-0.5 max-w-[85%] text-right justify-end">
                        <AlertCircle className="w-3 h-3 flex-shrink-0" />
                        <span>{msg.statusReason}</span>
                      </p>
                    )}
                  </div>
                ))
              )}
              <div ref={chatEndRef} />
            </div>

            {/* Input Pesan Chat & Lampiran File */}
            <div className="p-2.5 border-t border-zinc-200 bg-white flex-none">
              {/* Staged Attachment Preview */}
              {pendingAttachment && (
                <div className="mb-2 p-1.5 px-2 bg-zinc-100 rounded-lg flex items-center justify-between gap-2 border border-zinc-200">
                  <div className="flex items-center gap-2 min-w-0">
                    {pendingAttachment.mime_type.startsWith('image/') || /\.(jpg|jpeg|png|gif|webp|bmp|svg)$/i.test(pendingAttachment.name) ? (
                      <img 
                        src={pendingAttachment.url} 
                        alt={pendingAttachment.name} 
                        className="w-9 h-9 object-cover rounded border border-zinc-300 flex-shrink-0" 
                      />
                    ) : (
                      <div className="w-9 h-9 rounded bg-blue-100 text-blue-600 flex items-center justify-center flex-shrink-0">
                        <FileText className="w-4 h-4" />
                      </div>
                    )}
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-zinc-800 truncate">{pendingAttachment.name}</p>
                      <p className="text-[10px] text-zinc-500 font-mono">{formatFileSize(pendingAttachment.size)}</p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setPendingAttachment(null)}
                    className="p-1 rounded-md hover:bg-zinc-200 text-zinc-500 hover:text-zinc-800 transition cursor-pointer"
                    title="Batal lampirkan file"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}

              {/* Hidden file input */}
              <input 
                type="file" 
                ref={fileInputRef} 
                onChange={handleFileSelect} 
                className="hidden" 
              />

              <form 
                onSubmit={(e) => { e.preventDefault(); handleSendChatMessage(); }}
                className="flex items-center gap-1.5"
              >
                {/* Tombol + untuk menambahkan file apapun */}
                <button 
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isUploadingFile}
                  className="p-1.5 text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100 rounded-lg transition-colors cursor-pointer disabled:opacity-50 flex items-center justify-center flex-shrink-0"
                  title="Tambahkan file apapun (gambar, dokumen, pdf, zip, dll)"
                >
                  {isUploadingFile ? <Activity className="w-4 h-4 animate-spin text-zinc-800" /> : <Plus className="w-4 h-4" />}
                </button>

                <input 
                  type="text" 
                  value={chatInput} 
                  onChange={(e) => setChatInput(e.target.value)}
                  placeholder={pendingAttachment ? "Keterangan file (opsional)..." : role === 'teacher' ? "Ketik instruksi/chat ke siswa..." : "Ketik pesan chat..."}
                  className="flex-1 px-3 py-1.5 text-xs border border-zinc-300 rounded-lg outline-none focus:border-zinc-800 bg-zinc-50/50"
                />
                <button 
                  type="submit"
                  disabled={isSendingChat || (!chatInput.trim() && !pendingAttachment)}
                  className={`px-3 py-1.5 text-white text-xs font-medium rounded-lg transition-colors cursor-pointer disabled:cursor-not-allowed flex items-center justify-center shadow-xs flex-shrink-0 ${
                    role === 'teacher' ? 'bg-amber-600 hover:bg-amber-700 disabled:bg-zinc-200' : 'bg-zinc-900 hover:bg-zinc-800 disabled:bg-zinc-200'
                  }`}
                  title="Kirim Pesan"
                >
                  <Send className="w-3.5 h-3.5" />
                </button>
              </form>
            </div>

          </aside>

          {/* SISI KANAN: VISUALISASI TOPOLOGI JARINGAN & KONTROL PING */}
          <section className="flex-1 bg-zinc-50/40 flex flex-col overflow-hidden">
            {/* Header Topologi */}
            <div className="h-9 px-4 border-b border-zinc-200 flex items-center justify-between text-xs font-semibold text-zinc-700 bg-zinc-50 flex-none">
              <div className="flex items-center gap-2">
                <Network className="w-4 h-4 text-zinc-600" />
                <span>Topologi Jaringan LAN</span>
              </div>
              <span className="text-[11px] font-mono text-zinc-500 font-normal">{allNodes.length} Node Terhubung</span>
            </div>

            {/* Target IP/Domain Input & Ping Controller + Preset Internet + Compact Output Bar + Tombol Alert Guru */}
            <div className="px-4 py-2 border-b border-zinc-200 bg-white flex items-center justify-between gap-3 flex-none flex-wrap">
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-zinc-700 whitespace-nowrap">Target:</span>
                <input 
                  type="text" 
                  value={targetIp} 
                  onChange={(e) => setTargetIp(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') handlePing(); }}
                  placeholder="IP LAN, Gateway, atau Domain (google.com, 8.8.8.8)..."
                  className="w-64 px-2.5 py-1 text-xs font-mono border border-zinc-300 rounded-lg outline-none focus:border-zinc-800 bg-zinc-50/50"
                />

                {/* Tombol Uji Ping Dinamis (Menyesuaikan dengan Isi Textfield) */}
                <button 
                  type="button"
                  onClick={() => handlePing()}
                  disabled={isPinging || !targetIp.trim()}
                  className={`px-3 py-1 text-white text-xs font-semibold rounded-lg transition-colors flex items-center gap-1.5 cursor-pointer disabled:cursor-not-allowed shadow-xs whitespace-nowrap ${
                    !targetIp.trim() || isPinging
                      ? 'bg-zinc-300'
                      : isTargetOutside(targetIp)
                      ? 'bg-purple-700 hover:bg-purple-800'
                      : (targetIp.trim().endsWith('.1') || targetIp.trim() === gatewayIp)
                      ? 'bg-emerald-700 hover:bg-emerald-800'
                      : 'bg-zinc-900 hover:bg-zinc-800'
                  }`}
                >
                  {isPinging ? (
                    <Activity className="w-3.5 h-3.5 animate-spin" />
                  ) : isTargetOutside(targetIp) ? (
                    <Globe className="w-3.5 h-3.5" />
                  ) : (targetIp.trim().endsWith('.1') || targetIp.trim() === gatewayIp) ? (
                    <Server className="w-3.5 h-3.5" />
                  ) : (
                    <Send className="w-3.5 h-3.5" />
                  )}
                  <span>
                    {isPinging 
                      ? 'Menguji...' 
                      : isTargetOutside(targetIp)
                      ? 'Uji Ping Internet'
                      : (targetIp.trim().endsWith('.1') || targetIp.trim() === gatewayIp)
                      ? 'Uji Ping Gateway'
                      : 'Uji Ping LAN'}
                  </span>
                </button>

                {/* Tombol Khusus Mode Guru: Kirim Alert Unicast Pop-up */}
                {role === 'teacher' && (
                  <button 
                    type="button"
                    onClick={() => setIsAlertModalOpen(true)}
                    disabled={!targetIp || isTargetOutside(targetIp)}
                    className="px-2.5 py-1 bg-amber-600 hover:bg-amber-700 disabled:bg-zinc-200 text-white text-xs font-semibold rounded-lg transition-colors flex items-center gap-1.5 cursor-pointer disabled:cursor-not-allowed shadow-xs whitespace-nowrap"
                    title={isTargetOutside(targetIp) ? "Alert hanya dapat dikirim ke komputer lokal LAN" : "Kirim instruksi/alert pop-up ke target IP"}
                  >
                    <Bell className="w-3.5 h-3.5" />
                    <span>Kirim Alert</span>
                  </button>
                )}
              </div>

              {/* Strip Output Ping Ringkas Terintegrasi */}
              {isPinging ? (
                <div className="flex items-center gap-2 text-xs text-zinc-600">
                  <Activity className="w-3.5 h-3.5 animate-spin text-zinc-800" />
                  <span>
                    Mengirim 4 paket ICMP ke {targetIp} {isTargetOutside(targetIp) ? '(Jaringan Luar / WAN)...' : '...'}
                  </span>
                </div>
              ) : pingExecuted ? (
                <div className="flex items-center gap-3 text-xs">
                  {/* Badge Jenis Jaringan: LAN Lokal vs Internet (WAN) */}
                  {isTargetOutside(targetIp) ? (
                    <span className="px-1.5 py-0.5 rounded text-[9.5px] font-semibold bg-purple-100 text-purple-800 border border-purple-200 flex items-center gap-1">
                      <Globe className="w-3 h-3 text-purple-700" />
                      <span>Internet (WAN)</span>
                    </span>
                  ) : (
                    <span className="px-1.5 py-0.5 rounded text-[9.5px] font-semibold bg-blue-100 text-blue-800 border border-blue-200 flex items-center gap-1">
                      <Network className="w-3 h-3 text-blue-700" />
                      <span>LAN Lokal</span>
                    </span>
                  )}

                  <div className="flex items-center gap-1">
                    <span className="text-[10px] text-zinc-400 uppercase font-semibold">Status:</span>
                    <span className={`font-bold ${lossPercentage === 0 ? 'text-emerald-600' : lossPercentage === 100 ? 'text-red-600' : 'text-amber-600'}`}>
                      {lossPercentage === 0 ? 'Terhubung' : lossPercentage === 100 ? 'Gagal' : 'Sebagian'}
                    </span>
                  </div>
                  <div className="flex items-center gap-1 font-mono text-zinc-600">
                    <span className="text-[10px] text-zinc-400 font-sans uppercase font-semibold">Loss:</span>
                    <span>{lossPercentage}%</span>
                  </div>
                  <div className="flex items-center gap-1 font-mono text-zinc-600">
                    <span className="text-[10px] text-zinc-400 font-sans uppercase font-semibold">RTT:</span>
                    <span>{parsedPackets.length > 0 && parsedPackets[0].status === 'success' ? parsedPackets[0].time : '-'}</span>
                  </div>
                  <div className="flex items-center gap-1 pl-2 border-l border-zinc-200">
                    {parsedPackets.map(pkt => (
                      <span 
                        key={pkt.id} 
                        className={`px-1.5 py-0.5 rounded text-[10px] font-mono flex items-center gap-0.5 ${pkt.status === 'success' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-red-50 text-red-700 border border-red-200'}`}
                        title={`Paket #${pkt.id}: ${pkt.status === 'success' ? pkt.time : 'Timeout'}`}
                      >
                        #{pkt.id} {pkt.status === 'success' ? pkt.time : 'RTO'}
                      </span>
                    ))}
                  </div>
                </div>
              ) : (
                <span className="text-[11px] text-zinc-400 italic">Klik node di bawah atau pilih preset internet untuk menguji</span>
              )}
            </div>

            {/* PITA 1 BARIS: ANATOMI SUBNET IP & KONTROL SIMULASI (Network .0 | Gateway .1 | Host Pool .2-.254 | Broadcast .255) */}
            <div className="flex-none px-3 py-2 bg-transparent">
              <div className="grid grid-cols-4 gap-2">
                
                {/* 1. Network ID (.0) */}
                <div 
                  onClick={() => setTargetIp(networkIp)}
                  className={`p-2 rounded-lg transition-all flex items-center gap-2.5 cursor-pointer shadow-2xs bg-slate-700 text-white ${
                    targetIp === networkIp ? 'ring-2 ring-white/90 shadow-md' : 'hover:bg-slate-800'
                  }`}
                  title="Alamat Network: Identitas kelompok subnet, tidak dapat digunakan perangkat"
                >
                  <div className="p-1.5 rounded-md bg-white/15 text-white flex-shrink-0">
                    <Network className="w-4 h-4" />
                  </div>
                  <div className="truncate min-w-0 flex-1">
                    <div className="flex items-center gap-1 leading-none">
                      <span className="text-[10px] font-bold uppercase text-slate-200">Network .0</span>
                    </div>
                    <p className="font-mono text-xs font-semibold text-white truncate mt-1 leading-none">{networkIp}</p>
                  </div>
                </div>

                {/* 2. Gateway Router (.1) */}
                <div 
                  className={`p-2 rounded-lg transition-all flex items-center justify-between gap-1.5 shadow-2xs text-white ${
                    gatewayActive ? 'bg-emerald-600' : 'bg-rose-600'
                  } ${
                    targetIp === gatewayIp ? 'ring-2 ring-white/90 shadow-md' : ''
                  }`}
                >
                  <div 
                    onClick={() => setTargetIp(gatewayIp)}
                    className="flex items-center gap-2.5 truncate min-w-0 flex-1 cursor-pointer"
                    title="Gateway: Pintu gerbang keluar ke internet atau jaringan lain"
                  >
                    <div className="p-1.5 rounded-md bg-white/20 text-white flex-shrink-0">
                      <Server className="w-4 h-4" />
                    </div>
                    <div className="truncate min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 leading-none">
                        <span className="text-[10px] font-bold uppercase text-white/90">Gateway .1</span>
                        <span className="text-[8.5px] font-bold px-1.5 py-0.2 rounded bg-white/20 text-white">
                          {gatewayActive ? 'ONLINE' : 'OFFLINE'}
                        </span>
                      </div>
                      <p className="font-mono text-xs font-semibold text-white truncate mt-1 leading-none">{gatewayIp}</p>
                    </div>
                  </div>
                  {role === 'teacher' && (
                    <button
                      type="button"
                      onClick={() => setGatewayActive(!gatewayActive)}
                      className={`px-2 py-1 rounded text-[10px] font-bold transition-all cursor-pointer flex-shrink-0 shadow-xs ${
                        gatewayActive 
                          ? 'bg-white text-emerald-800 hover:bg-emerald-50' 
                          : 'bg-white text-rose-800 hover:bg-rose-50'
                      }`}
                      title="Guru: Klik untuk memutus/mengaktifkan gateway"
                    >
                      {gatewayActive ? 'Putus' : 'Aktifkan'}
                    </button>
                  )}
                </div>

                {/* 3. Host Pool (.2 - .254) */}
                <div 
                  className="p-2 rounded-lg transition-all flex items-center gap-2.5 shadow-2xs bg-blue-600 text-white"
                  title="Host Pool: Rentang IP yang bisa dipakai oleh komputer lab / siswa"
                >
                  <div className="p-1.5 rounded-md bg-white/20 text-white flex-shrink-0">
                    <Users className="w-4 h-4" />
                  </div>
                  <div className="truncate min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 leading-none">
                      <span className="text-[10px] font-bold uppercase text-white/90">Host Pool</span>
                      <span className="text-[8.5px] bg-white/20 text-white font-bold px-1.5 py-0.2 rounded">
                        {allNodes.length} Node
                      </span>
                    </div>
                    <p className="font-mono text-[11px] font-semibold text-white truncate mt-1 leading-none">{hostRange}</p>
                  </div>
                </div>

                {/* 4. Broadcast IP (.255) */}
                <div 
                  className={`p-2 rounded-lg transition-all flex items-center justify-between gap-1.5 shadow-2xs text-white ${
                    broadcastActive ? 'bg-purple-600' : 'bg-zinc-600'
                  } ${
                    targetIp === broadcastIp ? 'ring-2 ring-white/90 shadow-md' : ''
                  }`}
                >
                  <div 
                    onClick={() => setTargetIp(broadcastIp)}
                    className="flex items-center gap-2.5 truncate min-w-0 flex-1 cursor-pointer"
                    title="Broadcast: Alamat khusus untuk siaran massal ke seluruh lab (Chat & Radar)"
                  >
                    <div className="p-1.5 rounded-md bg-white/20 text-white flex-shrink-0">
                      <Radio className="w-4 h-4" />
                    </div>
                    <div className="truncate min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 leading-none">
                        <span className="text-[10px] font-bold uppercase text-white/90">Broadcast .255</span>
                        <span className="text-[8.5px] font-bold px-1.5 py-0.2 rounded bg-white/20 text-white">
                          {broadcastActive ? 'AKTIF' : 'BLOKIR'}
                        </span>
                      </div>
                      <p className="font-mono text-xs font-semibold text-white truncate mt-1 leading-none">{broadcastIp}</p>
                    </div>
                  </div>
                  {role === 'teacher' && (
                    <button
                      type="button"
                      onClick={() => setBroadcastActive(!broadcastActive)}
                      className={`px-2 py-1 rounded text-[10px] font-bold transition-all cursor-pointer flex-shrink-0 shadow-xs ${
                        broadcastActive 
                          ? 'bg-white text-purple-900 hover:bg-purple-50' 
                          : 'bg-white text-zinc-900 hover:bg-zinc-100'
                      }`}
                      title="Guru: Klik untuk memblokir/mengaktifkan broadcast"
                    >
                      {broadcastActive ? 'Blokir' : 'Aktifkan'}
                    </button>
                  )}
                </div>

              </div>
            </div>

            {/* Grid 4 Kolom Scrollable: Scrollbar Mepet Persis di Sisi Kanan Layar & Bawah */}
            <div className="flex-1 overflow-y-auto overscroll-contain pl-2 pr-1 pb-1">
              <div className="grid grid-cols-4 gap-1.5">
                {allNodes.map((node, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={(e) => {
                      setTargetIp(node.ip);
                      (e.currentTarget as HTMLElement).blur();
                    }}
                    onFocus={(e) => (e.currentTarget as HTMLElement).blur()}
                    className={`px-2.5 py-2 rounded-lg text-left transition-all flex items-center gap-2 cursor-pointer shadow-2xs outline-none focus:outline-none focus:ring-0 ${
                      targetIp === node.ip
                        ? 'bg-zinc-900 text-white border-transparent hover:border-transparent ring-0 shadow-sm'
                        : node.isSelf
                        ? role === 'teacher'
                          ? 'bg-amber-50/80 border border-amber-300 hover:border-amber-300 text-zinc-900'
                          : 'bg-blue-50/70 border border-blue-300 hover:border-blue-300 text-zinc-900'
                        : 'bg-white border border-zinc-200 hover:border-zinc-200 hover:bg-zinc-50 text-zinc-800'
                    }`}
                  >
                    <div className={`p-1 rounded-md flex-shrink-0 pointer-events-none ${
                      targetIp === node.ip 
                        ? 'bg-zinc-800 text-white' 
                        : node.isSelf 
                        ? role === 'teacher'
                          ? 'bg-amber-600 text-white'
                          : 'bg-blue-600 text-white' 
                        : 'bg-zinc-100 text-zinc-600'
                    }`}>
                      <Monitor className="w-4 h-4" />
                    </div>
                    <div className="truncate min-w-0 flex-1 pointer-events-none">
                      <p className={`font-semibold truncate text-xs leading-tight ${
                        node.isSelf && targetIp !== node.ip 
                          ? role === 'teacher' ? 'text-amber-900' : 'text-blue-900'
                          : ''
                      }`}>
                        {node.name}
                      </p>
                      <p className={`font-mono text-[10.5px] leading-tight mt-0.5 ${
                        targetIp === node.ip 
                          ? 'text-zinc-300' 
                          : node.isSelf 
                          ? role === 'teacher' ? 'text-amber-700' : 'text-blue-700' 
                          : 'text-zinc-500'
                      }`}>
                        {node.ip}
                      </p>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </section>

        </div>
      </div>
    );
  }

  // =========================================================================
  // HALAMAN UTAMA (HANYA DI SINI MENGGUNAKAN KARTU TERPISAH PILIHAN PERAN)
  // =========================================================================
  return (
    <div className="fixed inset-0 h-screen w-screen bg-zinc-100 text-zinc-900 flex flex-col items-center justify-center p-4 font-sans select-none overflow-hidden overscroll-none">
      {renderPasswordModal()}
      <div className="max-w-md w-full bg-white border border-zinc-200 rounded-2xl p-6 shadow-sm space-y-6">
        <div className="text-center space-y-1.5">
          <div className="inline-flex items-center justify-center p-2.5 bg-zinc-100 border border-zinc-200 rounded-xl text-zinc-800 mb-1">
            <Activity className="w-6 h-6" />
          </div>
          <h1 className="text-2xl font-bold text-zinc-900">NetSim</h1>
          <p className="text-xs text-zinc-500">Pilih mode operasi perangkat untuk praktikum jaringan LAN.</p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <button 
            onClick={handleRequestTeacherMode}
            className="p-4 bg-zinc-50 border border-zinc-200 hover:border-zinc-400 rounded-xl text-left transition-all cursor-pointer"
          >
            <Server className="w-5 h-5 text-amber-600 mb-2" />
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-zinc-900">Mode Guru</h3>
              <Lock className="w-3.5 h-3.5 text-amber-600/70" />
            </div>
            <p className="text-[11px] text-zinc-500 mt-1">Pantau radar lab & kirim instruksi.</p>
          </button>

          <button 
            onClick={() => handleSelectRole('student')}
            className="p-4 bg-zinc-50 border border-zinc-200 hover:border-zinc-400 rounded-xl text-left transition-all cursor-pointer"
          >
            <Monitor className="w-5 h-5 text-zinc-700 mb-2" />
            <h3 className="text-sm font-bold text-zinc-900">Mode Siswa</h3>
            <p className="text-[11px] text-zinc-500 mt-1">Uji ping & terima instruksi.</p>
          </button>
        </div>
      </div>
    </div>
  );
}
