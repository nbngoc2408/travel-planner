const { randomUUID } = require('node:crypto');

class CollectionRepository {
  constructor(store, collection) { this.store = store; this.collection = collection; }
  async all() { return this.store.read(this.collection, []); }
  async findById(id) { return (await this.all()).find((item) => item.id === id) || null; }
  async create(input) { let item; await this.store.mutate(this.collection, [], (items) => { item = { id: randomUUID(), ...input }; return [...items, item]; }); return item; }
  async update(id, patch) { let updated = null; await this.store.mutate(this.collection, [], (items) => { const index = items.findIndex((item) => item.id === id); if (index < 0) return items; updated = { ...items[index], ...patch, updatedAt: new Date().toISOString() }; const next = [...items]; next[index] = updated; return next; }); return updated; }
  async delete(id) { let deleted = false; await this.store.mutate(this.collection, [], (items) => { const next = items.filter((item) => item.id !== id); deleted = next.length !== items.length; return next; }); return deleted; }
}

class PlanRepository extends CollectionRepository {
  async findByUserId(userId) { return (await this.all()).filter((plan) => plan.userId === userId); }
  async findOwnedById(id, userId) { const plan = await this.findById(id); return plan && plan.userId === userId ? plan : null; }
}

class ReviewRepository extends CollectionRepository {
  async findOwnedById(id, userId) {
    const review = await this.findById(id);
    return review && review.userId === userId ? review : null;
  }

  async findByUserAndTarget(userId, destinationId, placeId = null) {
    const targetPlaceId = placeId || null;
    return (await this.all()).find((review) => review.userId === userId
      && review.destinationId === destinationId
      && (review.placeId || null) === targetPlaceId) || null;
  }

  async list({ destinationId, placeId, rating, sort = 'newest', page = 1, pageSize = 12 } = {}) {
    const filtered = (await this.all()).filter((review) => (!destinationId || review.destinationId === destinationId)
      && (!placeId || review.placeId === placeId)
      && (!rating || Number(review.rating) === Number(rating)));
    const byDate = (left, right, direction = -1) => String(left.createdAt || '').localeCompare(String(right.createdAt || '')) * direction
      || String(left.id || '').localeCompare(String(right.id || '')) * direction;
    const sorted = [...filtered].sort((left, right) => {
      if (sort === 'oldest') return byDate(left, right, 1);
      if (sort === 'highest') return Number(right.rating) - Number(left.rating) || byDate(left, right);
      if (sort === 'lowest') return Number(left.rating) - Number(right.rating) || byDate(left, right);
      return byDate(left, right);
    });
    const total = sorted.length;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const safePage = Math.min(Math.max(1, page), totalPages);
    const start = (safePage - 1) * pageSize;
    return {
      items: sorted.slice(start, start + pageSize),
      matched: sorted,
      total,
      page: safePage,
      pageSize,
      totalPages
    };
  }
}

class UserRepository extends CollectionRepository {
  async findByEmail(email) { return (await this.all()).find((user) => user.email.toLowerCase() === email.toLowerCase()) || null; }
}

module.exports = { CollectionRepository, PlanRepository, ReviewRepository, UserRepository };
