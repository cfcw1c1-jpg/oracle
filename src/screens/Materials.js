import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import * as WebBrowser from 'expo-web-browser';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import { supabase } from '../../lib/supabase';
import { ActionLink, EmptyRow, IconBadge } from '../components/admin-table';

const NAVY = '#002060';
const BUCKET = 'materials';
const NARROW_BREAKPOINT = 820;
// Signed links are only ever opened immediately after being generated, so
// they don't need to outlive a slow download of a large video.
const SIGNED_URL_TTL_SECONDS = 60 * 60;

function showAlert(title, message) {
  if (Platform.OS === 'web') {
    window.alert(`${title}\n\n${message}`);
  } else {
    Alert.alert(title, message);
  }
}

function confirmAction(title, message, onConfirm) {
  if (Platform.OS === 'web') {
    if (window.confirm(`${title}\n\n${message}`)) onConfirm();
    return;
  }
  Alert.alert(title, message, [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Delete', style: 'destructive', onPress: onConfirm },
  ]);
}

function formatBytes(bytes) {
  if (!bytes && bytes !== 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatDate(iso) {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// Icon + colors per broad file kind, decided by MIME type first and the
// extension second (some pickers report Office files as
// application/octet-stream).
const FILE_KINDS = {
  pdf: { icon: 'document-text', color: '#dc2626', bg: '#fef2f2', label: 'PDF' },
  slides: { icon: 'easel', color: '#ea580c', bg: '#fff7ed', label: 'Slides' },
  doc: { icon: 'document', color: '#2563eb', bg: '#eff6ff', label: 'Document' },
  sheet: { icon: 'grid', color: '#16a34a', bg: '#f0fdf4', label: 'Spreadsheet' },
  video: { icon: 'videocam', color: '#7c3aed', bg: '#f5f3ff', label: 'Video' },
  audio: { icon: 'musical-notes', color: '#db2777', bg: '#fdf2f8', label: 'Audio' },
  image: { icon: 'image', color: '#0891b2', bg: '#ecfeff', label: 'Image' },
  archive: { icon: 'archive', color: '#a16207', bg: '#fefce8', label: 'Archive' },
  other: { icon: 'attach', color: '#475569', bg: '#f1f5f9', label: 'File' },
};

function fileKind(mimeType, fileName) {
  const mime = (mimeType || '').toLowerCase();
  const ext = (fileName || '').split('.').pop().toLowerCase();
  if (mime === 'application/pdf' || ext === 'pdf') return FILE_KINDS.pdf;
  if (mime.includes('presentation') || mime.includes('powerpoint') || ['ppt', 'pptx', 'key', 'odp'].includes(ext)) return FILE_KINDS.slides;
  if (mime.includes('spreadsheet') || mime.includes('excel') || ['xls', 'xlsx', 'csv', 'ods'].includes(ext)) return FILE_KINDS.sheet;
  if (mime.includes('word') || mime.startsWith('text/') || ['doc', 'docx', 'txt', 'rtf', 'odt'].includes(ext)) return FILE_KINDS.doc;
  if (mime.startsWith('video/') || ['mp4', 'mov', 'm4v', 'webm', 'avi', 'mkv'].includes(ext)) return FILE_KINDS.video;
  if (mime.startsWith('audio/') || ['mp3', 'm4a', 'wav', 'aac', 'ogg', 'flac'].includes(ext)) return FILE_KINDS.audio;
  if (mime.startsWith('image/')) return FILE_KINDS.image;
  if (mime.includes('zip') || ['zip', 'rar', '7z'].includes(ext)) return FILE_KINDS.archive;
  return FILE_KINDS.other;
}

// Storage keys can't contain every character a real file name can, so the
// stored path gets a sanitized copy -- the original name is kept in
// materials.file_name and used for display and as the download name.
function storageSafeName(name) {
  return (name || 'file').normalize('NFKD').replace(/[^\w.-]+/g, '_').slice(-120);
}

// Admin-managed library of downloadable files, grouped into folders. Any
// role with the 'materials' page can browse/open/download; only an Admin
// sees the create/edit/upload/delete controls (and RLS + storage policies
// in scripts/sql/add-materials-library.sql enforce the same split
// server-side, so hiding the buttons isn't the only guard).
export default function Materials({ isAdmin }) {
  const { width } = useWindowDimensions();
  const isNarrow = width < NARROW_BREAKPOINT;

  const [folders, setFolders] = useState([]);
  const [foldersLoading, setFoldersLoading] = useState(true);
  const [folderSearch, setFolderSearch] = useState('');
  const [selectedFolderId, setSelectedFolderId] = useState(null);

  // Tagged with the folder they belong to, so switching folders never
  // briefly shows the previous folder's files while the new ones load.
  const [loadedFiles, setLoadedFiles] = useState({ folderId: null, rows: [] });
  const [filesLoading, setFilesLoading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(null); // { done, total } while uploading
  const [busyFileId, setBusyFileId] = useState(null);

  const [folderModal, setFolderModal] = useState(null); // { id?, name, description } while open
  const [savingFolder, setSavingFolder] = useState(false);

  const selectedFolder = folders.find((f) => f.id === selectedFolderId) || null;
  const files = loadedFiles.folderId === selectedFolderId ? loadedFiles.rows : [];

  useEffect(() => {
    loadFolders();
  }, []);

  useEffect(() => {
    if (selectedFolderId) loadFiles(selectedFolderId);
  }, [selectedFolderId]);

  async function loadFolders() {
    try {
      setFoldersLoading(true);
      const { data, error } = await supabase
        .from('material_folders')
        .select('id, name, description, created_at, materials ( count )')
        .order('name', { ascending: true });
      if (error) throw error;
      const rows = (data || []).map((f) => ({ ...f, fileCount: f.materials?.[0]?.count || 0 }));
      setFolders(rows);
      // Wide layout always shows a folder's contents beside the list, so
      // land on the first one rather than an empty right pane.
      if (!isNarrow) {
        setSelectedFolderId((prev) => (prev && rows.some((f) => f.id === prev) ? prev : rows[0]?.id || null));
      } else {
        setSelectedFolderId((prev) => (prev && rows.some((f) => f.id === prev) ? prev : null));
      }
    } catch (err) {
      showAlert('Error Loading Folders', err.message);
    } finally {
      setFoldersLoading(false);
    }
  }

  async function loadFiles(folderId) {
    try {
      setFilesLoading(true);
      const { data, error } = await supabase
        .from('materials')
        .select('id, folder_id, file_name, storage_path, mime_type, size_bytes, created_at')
        .eq('folder_id', folderId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      setLoadedFiles({ folderId, rows: data || [] });
    } catch (err) {
      showAlert('Error Loading Files', err.message);
    } finally {
      setFilesLoading(false);
    }
  }

  async function handleSaveFolder() {
    const name = (folderModal?.name || '').trim();
    const description = (folderModal?.description || '').trim();
    if (!name) {
      showAlert('Folder Name Required', 'Give the folder a name before saving.');
      return;
    }
    try {
      setSavingFolder(true);
      if (folderModal.id) {
        const { error } = await supabase
          .from('material_folders')
          .update({ name, description: description || null, updated_at: new Date().toISOString() })
          .eq('id', folderModal.id);
        if (error) throw error;
      } else {
        const { data, error } = await supabase
          .from('material_folders')
          .insert([{ name, description: description || null }])
          .select('id')
          .single();
        if (error) throw error;
        setSelectedFolderId(data.id);
      }
      setFolderModal(null);
      await loadFolders();
    } catch (err) {
      showAlert('Error Saving Folder', err.message);
    } finally {
      setSavingFolder(false);
    }
  }

  function handleDeleteFolder(folder) {
    confirmAction(
      'Delete Folder',
      `Delete "${folder.name}" and all ${folder.fileCount} file(s) in it? This can't be undone.`,
      async () => {
        try {
          // Storage objects aren't removed by the materials rows' ON DELETE
          // CASCADE, so collect and remove them explicitly first.
          const { data: rows, error: listError } = await supabase
            .from('materials')
            .select('storage_path')
            .eq('folder_id', folder.id);
          if (listError) throw listError;
          const paths = (rows || []).map((r) => r.storage_path);
          if (paths.length > 0) {
            const { error: removeError } = await supabase.storage.from(BUCKET).remove(paths);
            if (removeError) throw removeError;
          }
          const { error } = await supabase.from('material_folders').delete().eq('id', folder.id);
          if (error) throw error;
          if (selectedFolderId === folder.id) setSelectedFolderId(null);
          await loadFolders();
        } catch (err) {
          showAlert('Error Deleting Folder', err.message);
        }
      }
    );
  }

  async function handleUpload() {
    if (!selectedFolder || uploadProgress) return;
    try {
      // base64: false keeps web from reading every picked file (videos
      // included) into a base64 string up front -- asset.file is uploaded
      // directly instead.
      const result = await DocumentPicker.getDocumentAsync({ type: '*/*', multiple: true, base64: false });
      if (result.canceled || !result.assets?.length) return;

      const assets = result.assets;
      const failures = [];
      setUploadProgress({ done: 0, total: assets.length });

      for (let i = 0; i < assets.length; i++) {
        const asset = assets[i];
        const storagePath = `${selectedFolder.id}/${Date.now()}-${i}-${storageSafeName(asset.name)}`;
        try {
          const body = asset.file || (await (await fetch(asset.uri)).blob());
          const contentType = asset.mimeType || asset.file?.type || 'application/octet-stream';
          const { error: uploadError } = await supabase.storage
            .from(BUCKET)
            .upload(storagePath, body, { contentType, upsert: false });
          if (uploadError) throw uploadError;

          const { error: insertError } = await supabase.from('materials').insert([{
            folder_id: selectedFolder.id,
            file_name: asset.name,
            storage_path: storagePath,
            mime_type: contentType,
            size_bytes: asset.size ?? asset.file?.size ?? null,
          }]);
          if (insertError) {
            // Don't leave an orphaned object nobody can see or delete from the UI.
            await supabase.storage.from(BUCKET).remove([storagePath]);
            throw insertError;
          }
        } catch (err) {
          failures.push(`${asset.name}: ${err.message}`);
        }
        setUploadProgress({ done: i + 1, total: assets.length });
      }

      if (failures.length > 0) {
        showAlert('Some Files Failed to Upload', failures.join('\n'));
      }
    } catch (err) {
      showAlert('Error Uploading', err.message);
    } finally {
      setUploadProgress(null);
      if (selectedFolder) loadFiles(selectedFolder.id);
      loadFolders();
    }
  }

  function handleDeleteFile(file) {
    confirmAction('Delete File', `Delete "${file.file_name}"? This can't be undone.`, async () => {
      try {
        setBusyFileId(file.id);
        const { error: removeError } = await supabase.storage.from(BUCKET).remove([file.storage_path]);
        if (removeError) throw removeError;
        const { error } = await supabase.from('materials').delete().eq('id', file.id);
        if (error) throw error;
        await loadFiles(file.folder_id);
        loadFolders();
      } catch (err) {
        showAlert('Error Deleting File', err.message);
      } finally {
        setBusyFileId(null);
      }
    });
  }

  // "Open" previews inline where the browser can (PDF, video, audio,
  // images); "Download" asks Storage for a Content-Disposition: attachment
  // link under the original file name so it saves instead of opening.
  async function openFile(file, { download }) {
    try {
      setBusyFileId(file.id);
      const { data, error } = await supabase.storage
        .from(BUCKET)
        .createSignedUrl(file.storage_path, SIGNED_URL_TTL_SECONDS, download ? { download: file.file_name } : undefined);
      if (error) throw error;
      const url = data.signedUrl;

      if (Platform.OS === 'web') {
        window.open(url, '_blank', 'noopener');
      } else if (download) {
        // The system browser handles the actual save to Downloads/Files.
        await Linking.openURL(url);
      } else {
        await WebBrowser.openBrowserAsync(url);
      }
    } catch (err) {
      showAlert('Error Opening File', err.message);
    } finally {
      setBusyFileId(null);
    }
  }

  const visibleFolders = useMemo(() => {
    const q = folderSearch.trim().toLowerCase();
    if (!q) return folders;
    return folders.filter((f) => f.name.toLowerCase().includes(q) || (f.description || '').toLowerCase().includes(q));
  }, [folders, folderSearch]);

  const showFolderList = !isNarrow || !selectedFolder;
  const showFolderDetail = !isNarrow || !!selectedFolder;

  function renderFolderList() {
    return (
      <View style={[styles.card, isNarrow ? styles.flexFill : styles.folderPane]}>
        <View style={styles.cardHeader}>
          <View style={{ flex: 1 }}>
            <Text style={styles.cardTitle}>Materials</Text>
            <Text style={styles.cardSubtitle}>{folders.length} folder{folders.length === 1 ? '' : 's'}</Text>
          </View>
          {isAdmin && (
            <TouchableOpacity style={styles.primaryBtn} onPress={() => setFolderModal({ name: '', description: '' })}>
              <Ionicons name="add" size={16} color="#fff" />
              <Text style={styles.primaryBtnText}>New Folder</Text>
            </TouchableOpacity>
          )}
        </View>

        <View style={styles.searchWrap}>
          <Ionicons name="search" size={15} color="#94a3b8" />
          <TextInput
            style={styles.searchInput}
            placeholder="Search folders"
            placeholderTextColor="#94a3b8"
            value={folderSearch}
            onChangeText={setFolderSearch}
          />
        </View>

        {foldersLoading && folders.length === 0 ? (
          <ActivityIndicator style={{ marginTop: 24 }} color={NAVY} />
        ) : (
          <ScrollView style={styles.flexFill}>
            {visibleFolders.length === 0 && (
              <EmptyRow label={folders.length === 0 ? (isAdmin ? 'No folders yet. Create one to start uploading.' : 'No materials have been shared yet.') : 'No folders match your search.'} />
            )}
            {visibleFolders.map((folder) => {
              const selected = folder.id === selectedFolderId;
              return (
                <TouchableOpacity
                  key={folder.id}
                  style={[styles.folderRow, selected && !isNarrow && styles.folderRowSelected]}
                  onPress={() => setSelectedFolderId(folder.id)}
                  activeOpacity={0.7}
                >
                  {selected && !isNarrow && <View style={styles.rowAccent} />}
                  <IconBadge name={selected ? 'folder-open' : 'folder'} color="#d97706" bg="#fffbeb" />
                  <View style={styles.folderText}>
                    <Text style={styles.folderName} numberOfLines={1}>{folder.name}</Text>
                    {!!folder.description && (
                      <Text style={styles.folderDescription} numberOfLines={2}>{folder.description}</Text>
                    )}
                  </View>
                  <Text style={styles.folderCount}>{folder.fileCount}</Text>
                  {isNarrow && <Ionicons name="chevron-forward" size={16} color="#cbd5e1" />}
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        )}
      </View>
    );
  }

  function renderFolderDetail() {
    if (!selectedFolder) {
      return (
        <View style={[styles.card, styles.flexFill, styles.centered]}>
          <Ionicons name="folder-open-outline" size={32} color="#cbd5e1" />
          <Text style={styles.placeholderText}>Select a folder to see its files.</Text>
        </View>
      );
    }

    return (
      <View style={[styles.card, styles.flexFill]}>
        <View style={styles.cardHeader}>
          {isNarrow && (
            <TouchableOpacity style={styles.backBtn} onPress={() => setSelectedFolderId(null)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Ionicons name="chevron-back" size={20} color={NAVY} />
            </TouchableOpacity>
          )}
          <View style={{ flex: 1, minWidth: 180 }}>
            <Text style={styles.cardTitle} numberOfLines={2}>{selectedFolder.name}</Text>
            {!!selectedFolder.description && <Text style={styles.cardSubtitle}>{selectedFolder.description}</Text>}
          </View>
          {isAdmin && (
            <View style={styles.headerActions}>
              <ActionLink
                label="Edit"
                icon="create-outline"
                onPress={() => setFolderModal({ id: selectedFolder.id, name: selectedFolder.name, description: selectedFolder.description || '' })}
              />
              <ActionLink label="Delete" icon="trash-outline" color="#dc2626" onPress={() => handleDeleteFolder(selectedFolder)} />
              <TouchableOpacity style={[styles.primaryBtn, !!uploadProgress && styles.btnDisabled]} onPress={handleUpload} disabled={!!uploadProgress}>
                {uploadProgress ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Ionicons name="cloud-upload-outline" size={16} color="#fff" />
                )}
                <Text style={styles.primaryBtnText}>
                  {uploadProgress ? `Uploading ${uploadProgress.done}/${uploadProgress.total}` : 'Upload Files'}
                </Text>
              </TouchableOpacity>
            </View>
          )}
        </View>

        {filesLoading && files.length === 0 ? (
          <ActivityIndicator style={{ marginTop: 24 }} color={NAVY} />
        ) : (
          <ScrollView style={styles.flexFill}>
            {files.length === 0 && (
              <EmptyRow label={isAdmin ? 'This folder is empty. Use "Upload Files" to add PDFs, slides, documents, videos, or audio.' : 'This folder is empty.'} />
            )}
            {files.map((file, index) => {
              const kind = fileKind(file.mime_type, file.file_name);
              const busy = busyFileId === file.id;
              return (
                <View key={file.id} style={[styles.fileRow, isNarrow && styles.fileRowNarrow, index === files.length - 1 && styles.rowLast]}>
                  <View style={styles.fileMain}>
                    <IconBadge name={kind.icon} color={kind.color} bg={kind.bg} />
                    <View style={styles.folderText}>
                      <Text style={styles.fileName} numberOfLines={2}>{file.file_name}</Text>
                      <Text style={styles.fileMeta} numberOfLines={1}>
                        {[kind.label, formatBytes(file.size_bytes), formatDate(file.created_at)].filter(Boolean).join(' · ')}
                      </Text>
                    </View>
                  </View>
                  <View style={styles.fileActions}>
                    {busy ? (
                      <ActivityIndicator size="small" color={NAVY} />
                    ) : (
                      <>
                        <ActionLink label="Open" icon="eye-outline" onPress={() => openFile(file, { download: false })} />
                        <ActionLink label="Download" icon="download-outline" onPress={() => openFile(file, { download: true })} />
                        {isAdmin && <ActionLink label="Delete" icon="trash-outline" color="#dc2626" onPress={() => handleDeleteFile(file)} />}
                      </>
                    )}
                  </View>
                </View>
              );
            })}
          </ScrollView>
        )}
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={[styles.body, !isNarrow && styles.bodyWide]}>
        {showFolderList && renderFolderList()}
        {showFolderDetail && renderFolderDetail()}
      </View>

      <Modal visible={!!folderModal} transparent animationType="fade" onRequestClose={() => !savingFolder && setFolderModal(null)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>{folderModal?.id ? 'Edit Folder' : 'New Folder'}</Text>

            <Text style={styles.inputLabel}>Name</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g. CLP Talk 1 Materials"
              placeholderTextColor="#94a3b8"
              value={folderModal?.name || ''}
              onChangeText={(name) => setFolderModal((prev) => ({ ...prev, name }))}
              autoFocus
            />

            <Text style={styles.inputLabel}>Description</Text>
            <TextInput
              style={[styles.input, styles.inputMultiline]}
              placeholder="What's in this folder and who it's for"
              placeholderTextColor="#94a3b8"
              value={folderModal?.description || ''}
              onChangeText={(description) => setFolderModal((prev) => ({ ...prev, description }))}
              multiline
            />

            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.secondaryBtn} onPress={() => setFolderModal(null)} disabled={savingFolder}>
                <Text style={styles.secondaryBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.primaryBtn, savingFolder && styles.btnDisabled]} onPress={handleSaveFolder} disabled={savingFolder}>
                {savingFolder && <ActivityIndicator size="small" color="#fff" />}
                <Text style={styles.primaryBtnText}>{folderModal?.id ? 'Save' : 'Create Folder'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8fafc' },
  body: { flex: 1, padding: 16 },
  bodyWide: { flexDirection: 'row', gap: 16 },
  flexFill: { flex: 1 },
  centered: { alignItems: 'center', justifyContent: 'center', gap: 10 },

  card: {
    backgroundColor: '#ffffff', borderRadius: 16, borderWidth: 1, borderColor: '#eef1f6', overflow: 'hidden',
    ...Platform.select({
      web: { boxShadow: '0 1px 3px rgba(15,23,42,0.06), 0 8px 24px rgba(15,23,42,0.04)' },
      default: { shadowColor: '#0f172a', shadowOpacity: 0.06, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 2 },
    }),
  },
  folderPane: { width: 340 },
  cardHeader: {
    flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between',
    gap: 10, padding: 18, paddingBottom: 14,
  },
  cardTitle: { fontSize: 20, fontWeight: '800', color: '#1e293b' },
  cardSubtitle: { fontSize: 12, color: '#64748b', marginTop: 3 },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 14, flexWrap: 'wrap' },
  backBtn: { marginRight: 2 },

  primaryBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: NAVY,
    paddingHorizontal: 14, paddingVertical: 9, borderRadius: 10,
  },
  primaryBtnText: { color: '#ffffff', fontSize: 13, fontWeight: '700' },
  secondaryBtn: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 10, backgroundColor: '#f1f5f9' },
  secondaryBtnText: { color: '#334155', fontSize: 13, fontWeight: '700' },
  btnDisabled: { opacity: 0.6 },

  searchWrap: {
    flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 18, marginBottom: 10,
    paddingHorizontal: 12, borderRadius: 10, borderWidth: 1, borderColor: '#e2e8f0', backgroundColor: '#f8fafc',
  },
  searchInput: { flex: 1, paddingVertical: 9, fontSize: 13, color: '#1e293b' },

  folderRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 18, paddingVertical: 13,
    borderTopWidth: 1, borderTopColor: '#f4f6f9', position: 'relative',
  },
  folderRowSelected: { backgroundColor: '#f5f8ff' },
  rowAccent: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 3, backgroundColor: '#2563eb' },
  folderText: { flex: 1, minWidth: 0 },
  folderName: { fontSize: 14, fontWeight: '700', color: '#1e293b' },
  folderDescription: { fontSize: 12, color: '#64748b', marginTop: 2 },
  folderCount: {
    fontSize: 11, fontWeight: '800', color: '#475569', backgroundColor: '#f1f5f9',
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10, overflow: 'hidden',
  },

  fileRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 18, paddingVertical: 13,
    borderTopWidth: 1, borderTopColor: '#f4f6f9',
  },
  fileRowNarrow: { flexDirection: 'column', alignItems: 'stretch', gap: 8 },
  rowLast: { borderBottomWidth: 0 },
  fileMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12, minWidth: 0 },
  fileName: { fontSize: 13, fontWeight: '700', color: '#1e293b' },
  fileMeta: { fontSize: 11, color: '#94a3b8', marginTop: 2 },
  fileActions: { flexDirection: 'row', alignItems: 'center', gap: 14, justifyContent: 'flex-end' },

  placeholderText: { fontSize: 13, color: '#94a3b8' },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(15,23,42,0.45)', alignItems: 'center', justifyContent: 'center', padding: 20 },
  modalCard: { width: '100%', maxWidth: 460, backgroundColor: '#ffffff', borderRadius: 16, padding: 20 },
  modalTitle: { fontSize: 18, fontWeight: '800', color: '#1e293b', marginBottom: 14 },
  inputLabel: { fontSize: 11, fontWeight: '800', color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 },
  input: {
    borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10,
    fontSize: 14, color: '#1e293b', backgroundColor: '#f8fafc', marginBottom: 14,
  },
  inputMultiline: { minHeight: 90, textAlignVertical: 'top' },
  modalActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginTop: 4 },
});
