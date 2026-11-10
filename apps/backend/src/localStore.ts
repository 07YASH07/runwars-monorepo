import fs from 'fs';
import path from 'path';
import type { Territory } from '@runwars/shared';

export interface LocalUser {
  id: string;
  email: string;
  display_name: string;
  character_type: string;
  color: string;
  password_hash?: string;
  avatar_url?: string;
  bio?: string;
  cover_image_url?: string;
  coins?: number;
  unlocked_colors?: string[];
  selected_avatar?: string;
  unlocked_avatars?: string[];
  expo_push_token?: string;
  created_at: string;
}

export interface LocalRun {
  id: number;
  user_id: string;
  route_points: any[];
  distance_meters: number;
  activity_type: string;
  created_at: string;
}

export interface LocalPost {
  id: string;
  user_id: string;
  display_name?: string;
  character_type?: string;
  color?: string;
  title?: string;
  content: string;
  image_url?: string | null;
  post_type: string;
  related_id?: string | null;
  created_at: string;
  likes_count: number;
  comments_count: number;
}

interface LocalDbData {
  users: LocalUser[];
  runs: LocalRun[];
  posts: LocalPost[];
  territories: Territory[];
  followers: { follower_id: string; following_id: string }[];
}

const DATA_DIR = path.join(__dirname, '../../../data');
const DB_FILE = path.join(DATA_DIR, 'local-db.json');

class LocalStore {
  private users: Map<string, LocalUser> = new Map();
  private usersByEmail: Map<string, LocalUser> = new Map();
  private runs: LocalRun[] = [];
  private posts: LocalPost[] = [];
  private territories: Map<string, Territory> = new Map();
  private followers: Set<string> = new Set();
  private isLoaded = false;

  constructor() {
    this.init();
  }

  private init() {
    try {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }

      if (fs.existsSync(DB_FILE)) {
        const raw = fs.readFileSync(DB_FILE, 'utf-8');
        const data: LocalDbData = JSON.parse(raw);
        for (const u of data.users || []) {
          this.users.set(u.id, u);
          if (u.email) this.usersByEmail.set(u.email.toLowerCase(), u);
        }
        this.runs = data.runs || [];
        this.posts = data.posts || [];
        for (const t of data.territories || []) {
          this.territories.set(t.id, t);
        }
        for (const f of data.followers || []) {
          this.followers.add(`${f.follower_id}_${f.following_id}`);
        }
        console.log(`📦 [LocalStore] Loaded ${this.users.size} users, ${this.runs.length} runs, ${this.posts.length} posts from local persistence.`);
      } else {
        // Seed initial friendly test accounts
        this.seedInitialData();
      }
    } catch (e: any) {
      console.error('[LocalStore] Init error:', e.message);
      this.seedInitialData();
    }
    this.isLoaded = true;
  }

  private seedInitialData() {
    // Seed default admin and demo user
    const adminUser: LocalUser = {
      id: 'usr_admin',
      email: 'admin@strideclash.com',
      display_name: 'Admin Strider',
      character_type: 'warrior',
      color: '#00BFFF',
      password_hash: '$2a$10$wTqg.oFfOomjV856tF3Jt.63f00M2HkJZ0Q1K1Yf4cT/hX8y8jC0m', // admin123
      coins: 1000,
      bio: 'Master of the StrideClash Arena',
      created_at: new Date().toISOString()
    };
    const demoUser: LocalUser = {
      id: 'usr_demo',
      email: 'demo@strideclash.com',
      display_name: 'SpeedDemon',
      character_type: 'scout',
      color: '#FF2A55',
      password_hash: '$2a$10$wTqg.oFfOomjV856tF3Jt.63f00M2HkJZ0Q1K1Yf4cT/hX8y8jC0m', // admin123
      coins: 500,
      bio: 'Fastest runner in Sector 7',
      created_at: new Date().toISOString()
    };
    this.saveUser(adminUser);
    this.saveUser(demoUser);

    // Initial announcement
    this.posts.push({
      id: 'ann_welcome',
      user_id: 'usr_admin',
      display_name: 'StrideClash HQ',
      character_type: 'warrior',
      color: '#00BFFF',
      title: '⚔️ Welcome to StrideClash Beta!',
      content: 'Claim territories across your city, outrun your rivals, and dominate the global rankings.',
      image_url: null,
      post_type: 'announcement',
      related_id: null,
      created_at: new Date().toISOString(),
      likes_count: 24,
      comments_count: 5
    });

    this.persist();
  }

  private persist() {
    try {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }
      const followersList = Array.from(this.followers).map(pair => {
        const [follower_id, following_id] = pair.split('_');
        return { follower_id, following_id };
      });
      const data: LocalDbData = {
        users: Array.from(this.users.values()),
        runs: this.runs,
        posts: this.posts,
        territories: Array.from(this.territories.values()),
        followers: followersList
      };
      fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), 'utf-8');
    } catch (e: any) {
      console.error('[LocalStore] Persist error:', e.message);
    }
  }

  public saveTerritory(territory: Territory): void {
    this.territories.set(territory.id, territory);
    this.persist();
  }

  public deleteTerritory(id: string): void {
    this.territories.delete(id);
    this.persist();
  }

  public getAllTerritories(): Territory[] {
    return Array.from(this.territories.values());
  }

  public getUserById(id: string): LocalUser | undefined {
    return this.users.get(id);
  }

  public getUserByEmail(email: string): LocalUser | undefined {
    return this.usersByEmail.get(email.toLowerCase().trim());
  }

  public saveUser(user: LocalUser): void {
    this.users.set(user.id, user);
    if (user.email) {
      this.usersByEmail.set(user.email.toLowerCase().trim(), user);
    }
    this.persist();
  }

  public upsertUser(userId: string, data: Partial<LocalUser>): LocalUser {
    let existing = this.users.get(userId);
    if (!existing) {
      existing = {
        id: userId,
        email: data.email || `${userId}@strideclash.local`,
        display_name: data.display_name || 'Runner',
        character_type: data.character_type || 'scout',
        color: data.color || '#00BFFF',
        coins: 100,
        created_at: new Date().toISOString()
      };
    } else {
      if (data.display_name) existing.display_name = data.display_name;
      if (data.character_type) existing.character_type = data.character_type;
      if (data.color) existing.color = data.color;
      if (data.bio !== undefined) existing.bio = data.bio;
      if (data.avatar_url !== undefined) existing.avatar_url = data.avatar_url;
      if (data.cover_image_url !== undefined) existing.cover_image_url = data.cover_image_url;
      if (data.coins !== undefined) existing.coins = data.coins;
      if (data.expo_push_token !== undefined) existing.expo_push_token = data.expo_push_token;
      if (data.unlocked_colors) existing.unlocked_colors = data.unlocked_colors;
      if (data.selected_avatar) existing.selected_avatar = data.selected_avatar;
      if (data.unlocked_avatars) existing.unlocked_avatars = data.unlocked_avatars;
    }
    this.saveUser(existing);
    return existing;
  }

  public addRun(run: Omit<LocalRun, 'id'>): LocalRun {
    const newRun: LocalRun = {
      ...run,
      id: this.runs.length + 1,
    };
    this.runs.unshift(newRun);
    this.persist();
    return newRun;
  }

  public getUserRuns(userId: string): LocalRun[] {
    return this.runs.filter(r => r.user_id === userId);
  }

  public getUserStats(userId: string, totalZones: number = 0) {
    const userRuns = this.getUserRuns(userId);
    const totalDistance = userRuns.reduce((sum, r) => sum + (r.distance_meters || 0), 0);
    return {
      total_distance: totalDistance,
      total_runs: userRuns.length,
      total_zones: totalZones
    };
  }

  public addPost(post: Omit<LocalPost, 'id' | 'created_at' | 'likes_count' | 'comments_count'>): LocalPost {
    const newPost: LocalPost = {
      ...post,
      id: 'post_' + Date.now().toString(36),
      created_at: new Date().toISOString(),
      likes_count: 0,
      comments_count: 0
    };
    this.posts.unshift(newPost);
    this.persist();
    return newPost;
  }

  public getFeed(currentUserId?: string): any[] {
    return this.posts.map(p => {
      const user = this.getUserById(p.user_id);
      return {
        ...p,
        display_name: p.display_name || user?.display_name || 'Runner',
        character_type: p.character_type || user?.character_type || 'scout',
        color: p.color || user?.color || '#00BFFF',
        is_liked: false
      };
    });
  }

  public getUserPosts(userId: string): any[] {
    return this.posts.filter(p => p.user_id === userId);
  }

  public deletePost(postId: string): boolean {
    const initialLen = this.posts.length;
    this.posts = this.posts.filter(p => p.id !== postId);
    if (this.posts.length !== initialLen) {
      this.persist();
      return true;
    }
    return false;
  }

  public follow(followerId: string, followingId: string): void {
    this.followers.add(`${followerId}_${followingId}`);
    this.persist();
  }

  public unfollow(followerId: string, followingId: string): void {
    this.followers.delete(`${followerId}_${followingId}`);
    this.persist();
  }

  public getFollowers(userId: string): any[] {
    const result: any[] = [];
    for (const pair of this.followers) {
      const [followerId, followingId] = pair.split('_');
      if (followingId === userId) {
        const u = this.getUserById(followerId);
        if (u) result.push({ id: u.id, display_name: u.display_name, avatar_url: u.avatar_url, character_type: u.character_type, color: u.color, bio: u.bio });
      }
    }
    return result;
  }

  public getFollowing(userId: string): any[] {
    const result: any[] = [];
    for (const pair of this.followers) {
      const [followerId, followingId] = pair.split('_');
      if (followerId === userId) {
        const u = this.getUserById(followingId);
        if (u) result.push({ id: u.id, display_name: u.display_name, avatar_url: u.avatar_url, character_type: u.character_type, color: u.color, bio: u.bio });
      }
    }
    return result;
  }

  public getAllUsers(): LocalUser[] {
    return Array.from(this.users.values());
  }
}

export const localStore = new LocalStore();
