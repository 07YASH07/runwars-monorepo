import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Image,
  StatusBar,
  Modal,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from 'react-native';
import { CHARACTER_EMOJI, CharacterType } from '@runwars/shared';
import { useNavigation } from '@react-navigation/native';
import { useAuth } from '@/context/AuthContext';
import * as ImagePicker from 'expo-image-picker';
import { socketService } from '@/services/SocketService';

import { apiFetch, errorMessage } from '@/config/api';
import { uploadPostImage } from '@/services/ImageUploadService';

interface FeedItem {
  id: string;
  feed_type: 'post' | 'announcement';
  user_id?: string;
  display_name?: string;
  character_type?: string;
  color?: string;
  content?: string;
  image_url?: string;
  likes_count?: number;
  comments_count?: number;
  liked_by_user?: boolean;
  title?: string;
  body?: string;
  created_by?: string;
  created_at: string;
}

interface CommentItem {
  id: string;
  user_id?: string;
  user_name?: string;
  user_avatar?: string | null;
  display_name?: string;
  character_type?: string;
  color?: string;
  content: string;
  created_at: string;
}

interface ProfileStats {
  total_distance: number;
  total_runs: number;
  total_territory: number;
  total_zones: number;
}

interface ProfileData {
  user: {
    id: string;
    display_name: string;
    character_type: string;
    color: string;
    bio: string;
  };
  stats: ProfileStats;
  friends: {
    id: string;
    display_name: string;
    avatar_url?: string;
    character_type?: string;
    color?: string;
  }[];
}

function timeAgo(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const seconds = Math.floor((now.getTime() - date.getTime()) / 1000);

  if (seconds < 60) return 'Just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export default function FeedScreen() {
  const { user } = useAuth();
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [composerVisible, setComposerVisible] = useState(false);
  const [postContent, setPostContent] = useState('');
  // Local image picked by the user, pre-upload. Preview-only until the
  // post is submitted; at submit time we upload to Firebase Storage and
  // send the returned public URL in `imageUrl`.
  const [postImage, setPostImage] = useState<{ uri: string; mimeType?: string | null; fileSize?: number | null } | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0); // 0..1
  const [submittingPost, setSubmittingPost] = useState(false);

  const pickPostImage = async () => {
    const permissionResult = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (permissionResult.granted === false) {
      Alert.alert('Permission Required', 'Camera roll access is needed to upload a photo.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [4, 3],
      quality: 0.7,
    });
    if (!result.canceled && result.assets && result.assets[0]) {
      const a = result.assets[0];
      setPostImage({
        uri: a.uri,
        mimeType: (a as any).mimeType ?? null,
        fileSize: (a as any).fileSize ?? null,
      });
      setUploadProgress(0);
    }
  };

  const [commentDrawerVisible, setCommentDrawerVisible] = useState(false);
  const [selectedPostId, setSelectedPostId] = useState<string | null>(null);
  const [comments, setComments] = useState<CommentItem[]>([]);
  const [loadingComments, setLoadingComments] = useState(false);
  const [newCommentText, setNewCommentText] = useState('');
  const [submittingComment, setSubmittingComment] = useState(false);

  const [profileVisible, setProfileVisible] = useState(false);
  const [profileData, setProfileData] = useState<ProfileData | null>(null);
  const [loadingProfile, setLoadingProfile] = useState(false);

  const [expandedPosts, setExpandedPosts] = useState<Record<string, boolean>>({});
  const [feedError, setFeedError] = useState<string | null>(null);
  const navigation = useNavigation<any>();

  const fetchFeed = useCallback(async () => {
    try {
      const res = await apiFetch('/api/feed?limit=50');
      if (!res.ok) throw new Error(await errorMessage(res, 'Failed to load the feed.'));
      const data = await res.json();
      setFeed((Array.isArray(data) ? data : []).map((row: any) => ({
        ...row,
        id: String(row.id),
        feed_type: row.post_type === 'announcement' || row.feed_type === 'announcement' ? 'announcement' : 'post',
        liked_by_user: row.liked_by_user ?? !!row.is_liked,
        body: row.body ?? row.content,
      })));
      setFeedError(null);
    } catch (err: any) {
      setFeedError(err?.message || 'Could not load the feed.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user]);

  useEffect(() => {
    fetchFeed();
    const handleFeedUpdate = () => {
      fetchFeed();
    };
    socketService.onEvent('feed:updated', handleFeedUpdate);
    return () => {
      socketService.offEvent('feed:updated', handleFeedUpdate);
    };
  }, [fetchFeed]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchFeed();
  }, [fetchFeed]);

  const handleLike = async (post: FeedItem) => {
    if (!user) return;
    const originalLiked = post.liked_by_user;
    const originalCount = post.likes_count || 0;

    setFeed(prev =>
      prev.map(item =>
        item.id === post.id
          ? {
              ...item,
              liked_by_user: !originalLiked,
              likes_count: originalLiked ? originalCount - 1 : originalCount + 1,
            }
          : item
      )
    );

    try {
      const res = await apiFetch(`/api/posts/${post.id}/like`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.uid }),
      });
      if (!res.ok) throw new Error(await errorMessage(res, 'Failed to update like.'));
      const data = await res.json();
      setFeed(prev =>
        prev.map(item =>
          item.id === post.id
            ? { ...item, liked_by_user: data.liked, likes_count: data.likesCount }
            : item
        )
      );
    } catch (err) {
      setFeed(prev =>
        prev.map(item =>
          item.id === post.id
            ? { ...item, liked_by_user: originalLiked, likes_count: originalCount }
            : item
        )
      );
      Alert.alert('Like', (err as any)?.message || 'Failed to update like.');
    }
  };

  const openComments = async (postId: string) => {
    setSelectedPostId(postId);
    setCommentDrawerVisible(true);
    setLoadingComments(true);
    setNewCommentText('');
    try {
      const res = await apiFetch(`/api/posts/${postId}/comments`, {
        headers: { 'Bypass-Tunnel-Reminder': 'true' }
      });
      const data = await res.json();
      setComments(data);
    } catch (err) {
      console.error('[Feed] Failed to load comments:', err);
    } finally {
      setLoadingComments(false);
    }
  };

  const submitComment = async () => {
    if (!selectedPostId || !newCommentText.trim() || !user) return;
    setSubmittingComment(true);
    try {
      const res = await apiFetch(`/api/posts/${selectedPostId}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: user.uid,
          content: newCommentText.trim()
        })
      });
      if (res.ok) {
        const added = await res.json();
        setComments(prev => [...prev, added]);
        setNewCommentText('');
        setFeed(prev =>
          prev.map(item =>
            item.id === selectedPostId
              ? { ...item, comments_count: (item.comments_count || 0) + 1 }
              : item
          )
        );
      } else {
        throw new Error(await errorMessage(res, 'Failed to publish comment.'));
      }
    } catch (err: any) {
      Alert.alert('Comment', err?.message || 'Failed to publish comment.');
    } finally {
      setSubmittingComment(false);
    }
  };

  const openUserProfile = (targetUserId: string) => {
    if (!targetUserId || targetUserId === 'admin') return;
    if (targetUserId === user?.uid) navigation.navigate('PROFILE');
    else navigation.navigate('UserProfile', { userId: targetUserId });
  };

  const submitPost = async () => {
    if ((!postContent.trim() && !postImage) || !user) return;
    setSubmittingPost(true);
    try {
      let remoteImageUrl: string | undefined;

      if (postImage?.uri) {
        try {
          setUploadProgress(0.01);
          const uploaded = await uploadPostImage(
            { uri: postImage.uri, mimeType: postImage.mimeType, fileSize: postImage.fileSize },
            {
              userId: user.uid,
              kind: 'post',
              onProgress: (frac) => setUploadProgress(Math.max(0.01, Math.min(0.99, frac))),
            }
          );
          remoteImageUrl = uploaded.url;
          setUploadProgress(1);
        } catch (e: any) {
          Alert.alert('Image upload failed', e?.message || 'Could not upload the image. Try again or post without it.');
          setUploadProgress(0);
          return;
        }
      }

      const res = await apiFetch('/api/posts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: user.uid,
          content: postContent.trim(),
          imageUrl: remoteImageUrl,
        }),
      });

      if (res.ok) {
        setPostContent('');
        setPostImage(null);
        setUploadProgress(0);
        setComposerVisible(false);
        fetchFeed();
      } else {
        const err = await res.json().catch(() => ({}));
        Alert.alert('Publish Failed', err.error || 'Server error');
      }
    } catch (err: any) {
      Alert.alert('Could not post', err?.message || 'Network request failed.');
    } finally {
      setSubmittingPost(false);
    }
  };

  const toggleExpand = (postId: string) => {
    setExpandedPosts(prev => ({ ...prev, [postId]: !prev[postId] }));
  };

  const deleteOwnPost = (post: FeedItem) => {
    if (!user?.uid || post.user_id !== user.uid) return;
    Alert.alert(
      'Delete post?',
      'This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              const res = await apiFetch(`/api/posts/${post.id}`, { method: 'DELETE' });
              if (res.ok) {
                setFeed(prev => prev.filter(p => p.id !== post.id));
              } else {
                const err = await res.json().catch(() => ({}));
                Alert.alert('Delete failed', err.error || 'Server rejected delete.');
              }
            } catch {
              Alert.alert('Network', 'Could not reach server.');
            }
          },
        },
      ]
    );
  };

  const deleteOwnComment = (commentId: string, commentAuthorId: string, postId: string) => {
    if (!user?.uid || commentAuthorId !== user.uid) return;
    Alert.alert(
      'Delete comment?',
      'This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              const res = await apiFetch(`/api/comments/${commentId}`, { method: 'DELETE' });
              if (res.ok) {
                setComments(prev => prev.filter(c => c.id !== commentId));
                setFeed(prev => prev.map(p => p.id === postId ? { ...p, comments_count: Math.max(0, (p.comments_count || 0) - 1) } : p));
              } else {
                const err = await res.json().catch(() => ({}));
                Alert.alert('Delete failed', err.error || 'Server rejected delete.');
              }
            } catch {
              Alert.alert('Network', 'Could not reach server.');
            }
          },
        },
      ]
    );
  };

  const renderItem = ({ item }: { item: FeedItem }) => {
    const isAnnouncement = item.feed_type === 'announcement';

    if (isAnnouncement) {
      return (
        <View style={[styles.card, styles.announcementCard]}>
          <View style={styles.cardHeader}>
            <View style={[styles.avatarContainer, { backgroundColor: '#FF8C0022', borderColor: '#F59E0B' }]}>
              <Text style={styles.avatarEmoji}>📢</Text>
            </View>
            <View style={styles.headerInfo}>
              <Text style={[styles.ownerName, { color: '#F59E0B' }]}>ANNOUNCEMENT</Text>
              <Text style={styles.timeText}>{timeAgo(item.created_at)}</Text>
            </View>
            <View style={styles.announceBadge}>
              <Text style={styles.announceBadgeText}>SYSTEM</Text>
            </View>
          </View>
          <View style={styles.cardBody}>
            <Text style={styles.announceTitle}>{item.title}</Text>
            <Text style={styles.messageText}>{item.body}</Text>
          </View>
        </View>
      );
    }

    const emoji = CHARACTER_EMOJI[item.character_type as CharacterType] || '🏃';
    const isLong = (item.content || '').length > 140;
    const isExpanded = expandedPosts[item.id];
    const displayContent = isLong && !isExpanded
      ? item.content?.slice(0, 140) + '...'
      : item.content;

    let lastTap = 0;
    const handleImgPress = () => {
      const now = Date.now();
      if (now - lastTap < 300) {
        if (!item.liked_by_user) {
          handleLike(item);
        }
      } else {
        lastTap = now;
      }
    };

    const isOwnPost = user?.uid != null && item.user_id === user.uid;

    return (
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <TouchableOpacity
            onPress={() => item.user_id && openUserProfile(item.user_id)}
            style={[styles.avatarContainer, { borderColor: item.color || '#38BDF8' }]}
          >
            <Text style={styles.avatarEmoji}>{emoji}</Text>
          </TouchableOpacity>
          <View style={styles.headerInfo}>
            <View style={styles.nameRow}>
              <TouchableOpacity onPress={() => item.user_id && openUserProfile(item.user_id)}>
                <Text style={styles.ownerName} numberOfLines={1}>{item.display_name || 'Runner'}</Text>
              </TouchableOpacity>
              <Text style={[styles.classBadge, { color: item.color, borderColor: item.color + '44' }]}>
                {item.character_type?.toUpperCase()}
              </Text>
            </View>
            <Text style={styles.timeText}>{timeAgo(item.created_at)}</Text>
          </View>
          {isOwnPost && (
            <TouchableOpacity
              onPress={() => deleteOwnPost(item)}
              testID={`post-delete-${item.id}`}
              style={styles.postDeleteBtn}
              hitSlop={{ top: 10, right: 10, bottom: 10, left: 10 }}
            >
              <Text style={styles.postDeleteText}>⋯</Text>
            </TouchableOpacity>
          )}
        </View>

        <View style={styles.cardBody}>
          <Text style={styles.messageText}>
            {displayContent}{' '}
            {isLong && (
              <Text style={styles.readMoreText} onPress={() => toggleExpand(item.id)}>
                {isExpanded ? 'Show less' : 'Read more'}
              </Text>
            )}
          </Text>
        </View>

        {item.image_url ? (
          <TouchableOpacity activeOpacity={0.9} onPress={handleImgPress}>
            <Image source={{ uri: item.image_url }} style={styles.postImage} resizeMode="cover" />
          </TouchableOpacity>
        ) : null}

        <View style={styles.countsRow}>
          <Text style={styles.countText}>❤️ {item.likes_count || 0}</Text>
          <Text style={styles.countText}>💬 {item.comments_count || 0} comment{item.comments_count !== 1 ? 's' : ''}</Text>
        </View>

        <View style={styles.cardFooter}>
          <TouchableOpacity
            style={[styles.footerBtn, item.liked_by_user && styles.footerBtnActive]}
            onPress={() => handleLike(item)}
          >
            <Text style={[styles.footerBtnText, item.liked_by_user && styles.footerBtnTextActive]}>
              {item.liked_by_user ? '❤️ Liked' : '🖤 Like'}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.footerBtn} onPress={() => openComments(item.id)}>
            <Text style={styles.footerBtnText}>💬 Comment</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#0D0D1A" />

      <View style={styles.header}>
        <Text style={styles.headerTitle}>📰 SOCIAL FEED</Text>
        <Text style={styles.headerSub}>Connect, share, and dominate regional grids</Text>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color="#00BFFF" size="large" />
          <Text style={styles.loadingText}>Fetching social updates...</Text>
        </View>
      ) : feed.length === 0 ? (
        <View style={styles.center}>
          <Text style={styles.emptyEmoji}>{feedError ? '⚠️' : '👥'}</Text>
          <Text style={styles.emptyText}>{feedError ? 'Feed unavailable' : 'Social feed is empty.'}</Text>
          <Text style={styles.emptySub}>{feedError || 'Post an update or claim territories to start the feed!'}</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={() => { setLoading(true); fetchFeed(); }} testID="feed-retry">
            <Text style={styles.retryText}>{feedError ? 'Try again' : 'Refresh'}</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={feed}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#00BFFF" />
          }
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.scroll}
        />
      )}

      <TouchableOpacity
        style={styles.fab}
        onPress={() => setComposerVisible(true)}
        activeOpacity={0.8}
      >
        <Text style={styles.fabText}>+</Text>
      </TouchableOpacity>

      <Modal visible={composerVisible} animationType="slide" transparent>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.modalOverlay}
        >
          <View style={styles.composerCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>New Post</Text>
              <TouchableOpacity onPress={() => setComposerVisible(false)}>
                <Text style={styles.closeText}>Cancel</Text>
              </TouchableOpacity>
            </View>

            <TextInput
              style={styles.composerInput}
              placeholder="What's happening on your run today?..."
              placeholderTextColor="#4A4A6A"
              multiline
              maxLength={280}
              value={postContent}
              onChangeText={setPostContent}
            />

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Attach Image (Optional)</Text>
              {postImage?.uri ? (
                <View style={styles.selectedImageContainer}>
                  <Image source={{ uri: postImage.uri }} style={styles.selectedImagePreview} />
                  <TouchableOpacity style={styles.clearImageBtn} onPress={() => { setPostImage(null); setUploadProgress(0); }}>
                    <Text style={styles.clearImageText}>✕ Remove Image</Text>
                  </TouchableOpacity>
                  {submittingPost && uploadProgress > 0 && uploadProgress < 1 && (
                    <View style={styles.uploadProgressWrap}>
                      <View style={[styles.uploadProgressBar, { width: `${Math.round(uploadProgress * 100)}%` }]} />
                      <Text style={styles.uploadProgressLabel}>Uploading {Math.round(uploadProgress * 100)}%</Text>
                    </View>
                  )}
                </View>
              ) : (
                <TouchableOpacity style={styles.imagePickerBtn} onPress={pickPostImage}>
                  <Text style={styles.imagePickerBtnText}>🖼️ Choose Photo from Gallery</Text>
                </TouchableOpacity>
              )}
            </View>

            <TouchableOpacity
              style={[styles.publishBtn, (!postContent.trim() && !postImage) && styles.publishBtnDisabled]}
              disabled={(!postContent.trim() && !postImage) || submittingPost}
              onPress={submitPost}
              testID="feed-publish"
            >
              {submittingPost ? (
                <ActivityIndicator color="#0D0D1A" />
              ) : (
                <Text style={styles.publishText}>Publish Post</Text>
              )}
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <Modal visible={commentDrawerVisible} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            style={styles.commentDrawer}
          >
            <View style={styles.drawerHeader}>
              <Text style={styles.drawerTitle}>Comments</Text>
              <TouchableOpacity onPress={() => setCommentDrawerVisible(false)}>
                <Text style={styles.closeText}>Close</Text>
              </TouchableOpacity>
            </View>

            {loadingComments ? (
              <View style={styles.drawerLoading}>
                <ActivityIndicator color="#00BFFF" />
              </View>
            ) : comments.length === 0 ? (
              <View style={styles.drawerLoading}>
                <Text style={styles.noCommentsText}>No comments yet. Start the conversation!</Text>
              </View>
            ) : (
              <FlatList
                data={comments}
                keyExtractor={(item) => item.id}
                renderItem={({ item }) => {
                  const isOwnComment = !!user?.uid && item.user_id === user.uid;
                  return (
                    <View style={styles.commentRow}>
                      <View style={[styles.commentAvatar, { borderColor: item.color }]}>
                        <Text style={styles.commentAvatarEmoji}>
                          {CHARACTER_EMOJI[item.character_type as CharacterType] || '🏃'}
                        </Text>
                      </View>
                      <View style={styles.commentInfo}>
                        <Text style={styles.commentName}>{item.display_name || item.user_name || 'Runner'}</Text>
                        <Text style={styles.commentText}>{item.content}</Text>
                        <Text style={styles.commentTime}>{timeAgo(item.created_at)}</Text>
                      </View>
                      {isOwnComment && selectedPostId && (
                        <TouchableOpacity
                          onPress={() => deleteOwnComment(item.id, item.user_id!, selectedPostId)}
                          testID={`comment-delete-${item.id}`}
                          hitSlop={{ top: 10, right: 10, bottom: 10, left: 10 }}
                          style={styles.commentDeleteBtn}
                        >
                          <Text style={styles.commentDeleteText}>✕</Text>
                        </TouchableOpacity>
                      )}
                    </View>
                  );
                }}
                contentContainerStyle={styles.commentsList}
              />
            )}

            <View style={styles.commentComposer}>
              <TextInput
                style={styles.commentInput}
                placeholder="Write a comment..."
                placeholderTextColor="#4A4A6A"
                value={newCommentText}
                onChangeText={setNewCommentText}
              />
              <TouchableOpacity
                style={[styles.commentSubmitBtn, !newCommentText.trim() && styles.commentSubmitDisabled]}
                disabled={!newCommentText.trim() || submittingComment}
                onPress={submitComment}
              >
                {submittingComment ? (
                  <ActivityIndicator color="#000" />
                ) : (
                  <Text style={styles.commentSubmitText}>Send</Text>
                )}
              </TouchableOpacity>
            </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>


    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0B1220' },
  header: {
    paddingTop: 14,
    paddingBottom: 16,
    paddingHorizontal: 20,
    backgroundColor: '#101B2D',
    borderBottomWidth: 1,
    borderBottomColor: '#29384F',
  },
  headerTitle: { fontSize: 22, fontWeight: '900', color: '#38BDF8', letterSpacing: 2 },
  headerSub: { fontSize: 12, color: '#64748B', marginTop: 4 },
  scroll: { padding: 16, paddingBottom: 100 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  loadingText: { color: '#38BDF8', marginTop: 16, fontSize: 14, fontWeight: '600' },
  emptyEmoji: { fontSize: 64, marginBottom: 16 },
  emptyText: { color: '#FFFFFF', fontSize: 18, fontWeight: '700' },
  retryBtn: { marginTop: 16, height: 44, paddingHorizontal: 24, borderRadius: 8, borderWidth: 1, borderColor: '#38BDF8', alignItems: 'center', justifyContent: 'center' },
  retryText: { color: '#38BDF8', fontSize: 14, fontWeight: '700' },
  emptySub: { color: '#64748B', fontSize: 13, marginTop: 8, textAlign: 'center', paddingHorizontal: 20 },
  card: { backgroundColor: '#162238', borderRadius: 12, borderWidth: 1, borderColor: '#29384F', marginBottom: 16, padding: 16 },
  announcementCard: { borderColor: '#FF8C0066', backgroundColor: '#1E1408' },
  cardHeader: { flexDirection: 'row', alignItems: 'center' },
  avatarContainer: { width: 44, height: 44, borderRadius: 22, borderWidth: 2, backgroundColor: '#0B1220', alignItems: 'center', justifyContent: 'center' },
  avatarEmoji: { fontSize: 20 },
  headerInfo: { marginLeft: 12, flex: 1 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  ownerName: { fontSize: 14, fontWeight: '800', color: '#FFFFFF' },
  classBadge: { fontSize: 8, fontWeight: '900', paddingHorizontal: 5, paddingVertical: 2, borderRadius: 4, borderWidth: 1 },
  timeText: { fontSize: 11, color: '#64748B', marginTop: 2 },
  announceBadge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 4, backgroundColor: '#FF8C0022', borderWidth: 1, borderColor: '#FF8C0044' },
  announceBadgeText: { fontSize: 9, fontWeight: '900', color: '#F59E0B' },
  cardBody: { marginVertical: 12 },
  announceTitle: { fontSize: 16, fontWeight: '900', color: '#F59E0B', marginBottom: 6 },
  messageText: { fontSize: 14, color: '#CBD5E1', lineHeight: 21 },
  readMoreText: { color: '#38BDF8', fontWeight: '800' },
  postImage: { width: '100%', height: 240, borderRadius: 8, marginVertical: 8, backgroundColor: '#0B1220' },
  countsRow: { flexDirection: 'row', justifyContent: 'space-between', paddingTop: 8, borderTopWidth: 1, borderTopColor: '#2A2A4A44' },
  countText: { fontSize: 11, color: '#64748B', fontWeight: '600' },
  cardFooter: { flexDirection: 'row', marginTop: 10, borderTopWidth: 1, borderTopColor: '#2A2A4A44', paddingTop: 10, gap: 16 },
  footerBtn: { flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: 8, backgroundColor: '#2A2A4A33' },
  footerBtnActive: { backgroundColor: '#00BFFF11' },
  footerBtnText: { fontSize: 12, color: '#94A3B8', fontWeight: '800' },
  footerBtnTextActive: { color: '#38BDF8' },
  fab: { position: 'absolute', bottom: 24, right: 24, width: 56, height: 56, borderRadius: 28, backgroundColor: '#38BDF8', alignItems: 'center', justifyContent: 'center', shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 5, elevation: 8 },
  fabText: { fontSize: 32, color: '#0B1220', fontWeight: '300', marginTop: -2 },
  modalOverlay: { flex: 1, backgroundColor: '#000000AA', justifyContent: 'center', alignItems: 'center' },
  composerCard: { width: '90%', backgroundColor: '#162238', borderRadius: 16, borderWidth: 1.5, borderColor: '#00BFFF44', padding: 20, gap: 16 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  modalTitle: { fontSize: 18, fontWeight: '900', color: '#FFFFFF' },
  closeText: { color: '#EF4444', fontWeight: '700' },
  composerInput: { backgroundColor: '#0B1220', borderRadius: 8, color: '#FFFFFF', padding: 12, fontSize: 14, height: 120, textAlignVertical: 'top', borderWidth: 1, borderColor: '#29384F' },
  inputGroup: {},
  inputLabel: { fontSize: 11, color: '#64748B', fontWeight: '800', marginBottom: 6 },
  imageInput: { backgroundColor: '#0B1220', borderRadius: 8, color: '#FFFFFF', padding: 10, fontSize: 13, borderWidth: 1, borderColor: '#29384F' },
  publishBtn: { backgroundColor: '#38BDF8', paddingVertical: 12, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  publishBtnDisabled: { backgroundColor: '#64748B', opacity: 0.5 },
  publishText: { color: '#0B1220', fontWeight: '900', fontSize: 14 },
  commentDrawer: { width: '100%', height: '75%', marginTop: 'auto', backgroundColor: '#101B2D', borderTopLeftRadius: 20, borderTopRightRadius: 20, borderWidth: 1.5, borderColor: '#29384F', padding: 16 },
  drawerHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  drawerTitle: { fontSize: 18, fontWeight: '900', color: '#FFFFFF' },
  drawerLoading: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  noCommentsText: { color: '#64748B', textAlign: 'center' },
  commentsList: { paddingBottom: 20 },
  commentRow: { flexDirection: 'row', gap: 10, marginBottom: 14 },
  commentAvatar: { width: 32, height: 32, borderRadius: 16, borderWidth: 1.5, backgroundColor: '#0B1220', alignItems: 'center', justifyContent: 'center' },
  commentAvatarEmoji: { fontSize: 14 },
  commentInfo: { flex: 1, backgroundColor: '#162238', borderRadius: 8, padding: 8 },
  commentName: { fontSize: 12, fontWeight: '800', color: '#FFFFFF' },
  commentText: { fontSize: 13, color: '#CBD5E1', marginTop: 2 },
  commentTime: { fontSize: 9, color: '#64748B', marginTop: 4 },
  commentComposer: { flexDirection: 'row', gap: 8, paddingTop: 10, borderTopWidth: 1, borderTopColor: '#29384F' },
  commentInput: { flex: 1, backgroundColor: '#0B1220', borderRadius: 20, color: '#FFFFFF', paddingHorizontal: 16, paddingVertical: 8, borderWidth: 1, borderColor: '#29384F' },
  commentSubmitBtn: { backgroundColor: '#38BDF8', borderRadius: 20, paddingHorizontal: 16, justifyContent: 'center', alignItems: 'center' },
  commentSubmitDisabled: { backgroundColor: '#64748B', opacity: 0.5 },
  commentSubmitText: { color: '#0B1220', fontWeight: '900', fontSize: 12 },
  profileCard: { width: '80%', backgroundColor: '#162238', borderRadius: 16, borderWidth: 1.5, borderColor: '#38BDF8', padding: 24, alignItems: 'center' },
  profileAvatar: { width: 80, height: 80, borderRadius: 40, borderWidth: 3, backgroundColor: '#0B1220', alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  profileAvatarEmoji: { fontSize: 44 },
  profileName: { fontSize: 18, fontWeight: '900', color: '#FFFFFF' },
  profileClass: { fontSize: 11, fontWeight: '900', marginTop: 4 },
  profileBio: { fontSize: 13, color: '#94A3B8', textAlign: 'center', marginTop: 10, fontStyle: 'italic' },
  profileDivider: { width: '100%', height: 1, backgroundColor: '#29384F', marginVertical: 16 },
  statsGrid: { flexDirection: 'row', width: '100%', justifyContent: 'space-around' },
  statsGridCol: { alignItems: 'center' },
  gridStatVal: { fontSize: 16, fontWeight: '900', color: '#FFFFFF' },
  gridStatLbl: { fontSize: 9, color: '#64748B', fontWeight: '800', marginTop: 2 },
  imagePickerBtn: { backgroundColor: '#0B1220', borderRadius: 8, borderWidth: 1, borderColor: '#29384F', borderStyle: 'dashed', paddingVertical: 16, alignItems: 'center', justifyContent: 'center' },
  imagePickerBtnText: { color: '#38BDF8', fontSize: 13, fontWeight: '800' },
  selectedImageContainer: { alignItems: 'center', gap: 8 },
  selectedImagePreview: { width: '100%', height: 120, borderRadius: 8, backgroundColor: '#0B1220' },
  clearImageBtn: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 12, backgroundColor: '#FF3B3022' },
  clearImageText: { color: '#EF4444', fontSize: 11, fontWeight: '800' },
  uploadProgressWrap: { width: '100%', height: 20, borderRadius: 10, backgroundColor: '#0B1220', overflow: 'hidden', position: 'relative', borderWidth: 1, borderColor: '#29384F' },
  uploadProgressBar: { position: 'absolute', left: 0, top: 0, bottom: 0, backgroundColor: '#38BDF8' },
  uploadProgressLabel: { color: '#FFFFFF', fontSize: 10, fontWeight: '800', textAlign: 'center', lineHeight: 20 },
  postDeleteBtn: { paddingHorizontal: 8, paddingVertical: 4 },
  postDeleteText: { color: '#94A3B8', fontSize: 22, fontWeight: '800' },
  commentDeleteBtn: { paddingHorizontal: 6, paddingVertical: 4, justifyContent: 'flex-start' },
  commentDeleteText: { color: '#EF4444', fontSize: 14, fontWeight: '800' },
  friendBtn: { backgroundColor: '#38BDF8', width: '100%', paddingVertical: 10, borderRadius: 8, alignItems: 'center', justifyContent: 'center', marginTop: 16 },
  friendBtnActive: { backgroundColor: '#29384F', borderWidth: 1, borderColor: '#38BDF8' },
  friendBtnText: { color: '#0B1220', fontWeight: '900', fontSize: 13 },
  friendBtnTextActive: { color: '#38BDF8' },
});
