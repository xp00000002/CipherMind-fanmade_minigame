/* chess.js - 国际象棋规则引擎（纯逻辑，无 UI） */
(function (global) {
  'use strict';

  var FILES = 'abcdefgh';

  function Chess() {
    this.reset();
  }

  Chess.prototype.reset = function () {
    this.board = this._emptyBoard();
    this.turn = 'w';
    this.castling = { w: { K: true, Q: true }, b: { K: true, Q: true } };
    this.ep = null;          // 吃过路兵目标格 [r, c]
    this.halfmove = 0;       // 50 回合规则
    this.fullmove = 1;
    this.history = [];       // 走子历史（用于悔棋/重复局面）
    this.positionKeys = [];  // 局面键值序列（用于三次重复）
    this.rules = { noCastling: false, noPromotion: false };
    this._setupInitialPosition();
    this.positionKeys.push(this.positionKey());
  };

  Chess.prototype.setRules = function (rules) {
    if (!rules) return;
    if (typeof rules.noCastling === 'boolean') this.rules.noCastling = rules.noCastling;
    if (typeof rules.noPromotion === 'boolean') this.rules.noPromotion = rules.noPromotion;
  };

  Chess.prototype._emptyBoard = function () {
    var b = [];
    for (var r = 0; r < 8; r++) b.push(new Array(8).fill(null));
    return b;
  };

  Chess.prototype._setupInitialPosition = function () {
    var back = ['r', 'n', 'b', 'q', 'k', 'b', 'n', 'r'];
    for (var c = 0; c < 8; c++) {
      this.board[0][c] = { type: back[c], color: 'w' };
      this.board[1][c] = { type: 'p', color: 'w' };
      this.board[6][c] = { type: 'p', color: 'b' };
      this.board[7][c] = { type: back[c], color: 'b' };
    }
  };

  Chess.squareToRC = function (sq) {
    return [parseInt(sq[1], 10) - 1, FILES.indexOf(sq[0])];
  };
  Chess.rcToSquare = function (r, c) {
    return FILES[c] + (r + 1);
  };

  Chess.prototype.getBoard = function () { return this.board; };
  Chess.prototype.getTurn = function () { return this.turn; };

  Chess.prototype.pieceAt = function (sq) {
    var rc = Chess.squareToRC(sq);
    var p = this.board[rc[0]][rc[1]];
    return p ? { type: p.type, color: p.color } : null;
  };

  Chess.prototype._inBounds = function (r, c) {
    return r >= 0 && r < 8 && c >= 0 && c < 8;
  };

  Chess.prototype._addMove = function (list, fr, fc, tr, tc, opts) {
    opts = opts || {};
    var target = this.board[tr][tc];
    list.push({
      from: Chess.rcToSquare(fr, fc),
      to: Chess.rcToSquare(tr, tc),
      piece: this.board[fr][fc].type,
      color: this.board[fr][fc].color,
      captured: opts.captured ? opts.captured : (target ? target.type : null),
      promotion: opts.promotion || null,
      flags: opts.flags || []
    });
  };

  Chess.prototype._pseudoMoves = function (r, c) {
    var piece = this.board[r][c];
    if (!piece) return [];
    var moves = [];
    var color = piece.color;
    var opp = color === 'w' ? 'b' : 'w';
    var dir = color === 'w' ? 1 : -1;
    var i, dr, dc, tr, tc, tgt;

    switch (piece.type) {
      case 'p': {
        var startRank = color === 'w' ? 1 : 6;
        var promoRank = color === 'w' ? 7 : 0;
        var oneR = r + dir;
        if (this._inBounds(oneR, c) && !this.board[oneR][c]) {
          if (oneR === promoRank) {
            if (this.rules.noPromotion) {
              this._addMove(moves, r, c, oneR, c);
            } else {
              for (i = 0; i < 4; i++) this._addMove(moves, r, c, oneR, c, { promotion: ['q', 'r', 'b', 'n'][i] });
            }
          } else {
            this._addMove(moves, r, c, oneR, c);
          }
          var twoR = r + 2 * dir;
          if (r === startRank && this._inBounds(twoR, c) && !this.board[twoR][c]) {
            this._addMove(moves, r, c, twoR, c, { flags: ['double'] });
          }
        }
        for (i = 0; i < 2; i++) {
          dc = i === 0 ? -1 : 1;
          tr = r + dir; tc = c + dc;
          if (!this._inBounds(tr, tc)) continue;
          tgt = this.board[tr][tc];
          if (tgt && tgt.color === opp) {
            if (tr === promoRank) {
              if (this.rules.noPromotion) {
                this._addMove(moves, r, c, tr, tc, { flags: ['capture'] });
              } else {
                for (var j = 0; j < 4; j++) this._addMove(moves, r, c, tr, tc, { promotion: ['q', 'r', 'b', 'n'][j], flags: ['capture'] });
              }
            } else {
              this._addMove(moves, r, c, tr, tc, { flags: ['capture'] });
            }
          } else if (this.ep && this.ep[0] === tr && this.ep[1] === tc) {
            this._addMove(moves, r, c, tr, tc, { flags: ['ep', 'capture'], captured: 'p' });
          }
        }
        break;
      }
      case 'n': {
        var knightD = [[2, 1], [2, -1], [-2, 1], [-2, -1], [1, 2], [1, -2], [-1, 2], [-1, -2]];
        for (i = 0; i < 8; i++) {
          dr = knightD[i][0]; dc = knightD[i][1];
          tr = r + dr; tc = c + dc;
          if (!this._inBounds(tr, tc)) continue;
          tgt = this.board[tr][tc];
          if (!tgt || tgt.color !== color) this._addMove(moves, r, c, tr, tc, tgt ? { flags: ['capture'] } : {});
        }
        break;
      }
      case 'b': {
        var bD = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
        for (i = 0; i < 4; i++) {
          dr = bD[i][0]; dc = bD[i][1];
          tr = r + dr; tc = c + dc;
          while (this._inBounds(tr, tc)) {
            tgt = this.board[tr][tc];
            if (!tgt) this._addMove(moves, r, c, tr, tc);
            else { if (tgt.color !== color) this._addMove(moves, r, c, tr, tc, { flags: ['capture'] }); break; }
            tr += dr; tc += dc;
          }
        }
        break;
      }
      case 'r': {
        var rD = [[1, 0], [-1, 0], [0, 1], [0, -1]];
        for (i = 0; i < 4; i++) {
          dr = rD[i][0]; dc = rD[i][1];
          tr = r + dr; tc = c + dc;
          while (this._inBounds(tr, tc)) {
            tgt = this.board[tr][tc];
            if (!tgt) this._addMove(moves, r, c, tr, tc);
            else { if (tgt.color !== color) this._addMove(moves, r, c, tr, tc, { flags: ['capture'] }); break; }
            tr += dr; tc += dc;
          }
        }
        break;
      }
      case 'q': {
        var qD = [[1, 1], [1, -1], [-1, 1], [-1, -1], [1, 0], [-1, 0], [0, 1], [0, -1]];
        for (i = 0; i < 8; i++) {
          dr = qD[i][0]; dc = qD[i][1];
          tr = r + dr; tc = c + dc;
          while (this._inBounds(tr, tc)) {
            tgt = this.board[tr][tc];
            if (!tgt) this._addMove(moves, r, c, tr, tc);
            else { if (tgt.color !== color) this._addMove(moves, r, c, tr, tc, { flags: ['capture'] }); break; }
            tr += dr; tc += dc;
          }
        }
        break;
      }
      case 'k': {
        var kD = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
        for (i = 0; i < 8; i++) {
          dr = kD[i][0]; dc = kD[i][1];
          tr = r + dr; tc = c + dc;
          if (!this._inBounds(tr, tc)) continue;
          tgt = this.board[tr][tc];
          if (!tgt || tgt.color !== color) this._addMove(moves, r, c, tr, tc, tgt ? { flags: ['capture'] } : {});
        }
        var kRow = color === 'w' ? 0 : 7;
        if (r === kRow && c === 4) {
          if (this.castling[color].K && !this.board[kRow][5] && !this.board[kRow][6] &&
            !this._isAttacked([kRow, 4], opp) && !this._isAttacked([kRow, 5], opp) && !this._isAttacked([kRow, 6], opp)) {
            this._addMove(moves, r, c, kRow, 6, { flags: ['kingside'] });
          }
          if (this.castling[color].Q && !this.board[kRow][1] && !this.board[kRow][2] && !this.board[kRow][3] &&
            !this._isAttacked([kRow, 4], opp) && !this._isAttacked([kRow, 3], opp) && !this._isAttacked([kRow, 2], opp)) {
            this._addMove(moves, r, c, kRow, 2, { flags: ['queenside'] });
          }
        }
        break;
      }
    }
    return moves;
  };

  Chess.prototype._isAttacked = function (sq, byColor) {
    var r = sq[0], c = sq[1];
    var dir = byColor === 'w' ? 1 : -1;
    var i, dr, dc, tr, tc, p;
    for (i = 0; i < 2; i++) {
      dc = i === 0 ? -1 : 1;
      tr = r - dir; tc = c + dc;
      if (this._inBounds(tr, tc) && this.board[tr][tc] && this.board[tr][tc].color === byColor && this.board[tr][tc].type === 'p') return true;
    }
    var kD = [[2, 1], [2, -1], [-2, 1], [-2, -1], [1, 2], [1, -2], [-1, 2], [-1, -2]];
    for (i = 0; i < 8; i++) {
      dr = kD[i][0]; dc = kD[i][1];
      tr = r + dr; tc = c + dc;
      if (this._inBounds(tr, tc) && this.board[tr][tc] && this.board[tr][tc].color === byColor && this.board[tr][tc].type === 'n') return true;
    }
    var kKing = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
    for (i = 0; i < 8; i++) {
      dr = kKing[i][0]; dc = kKing[i][1];
      tr = r + dr; tc = c + dc;
      if (this._inBounds(tr, tc) && this.board[tr][tc] && this.board[tr][tc].color === byColor && this.board[tr][tc].type === 'k') return true;
    }
    var straight = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    for (i = 0; i < 4; i++) {
      dr = straight[i][0]; dc = straight[i][1];
      tr = r + dr; tc = c + dc;
      while (this._inBounds(tr, tc)) {
        p = this.board[tr][tc];
        if (p) { if (p.color === byColor && (p.type === 'r' || p.type === 'q')) return true; break; }
        tr += dr; tc += dc;
      }
    }
    var diag = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
    for (i = 0; i < 4; i++) {
      dr = diag[i][0]; dc = diag[i][1];
      tr = r + dr; tc = c + dc;
      while (this._inBounds(tr, tc)) {
        p = this.board[tr][tc];
        if (p) { if (p.color === byColor && (p.type === 'b' || p.type === 'q')) return true; break; }
        tr += dr; tc += dc;
      }
    }
    return false;
  };

  Chess.prototype._kingSquare = function (color) {
    for (var r = 0; r < 8; r++) for (var c = 0; c < 8; c++) {
      var p = this.board[r][c];
      if (p && p.type === 'k' && p.color === color) return [r, c];
    }
    return null;
  };

  Chess.prototype.inCheck = function (color) {
    var ks = this._kingSquare(color);
    return ks ? this._isAttacked(ks, color === 'w' ? 'b' : 'w') : false;
  };

  Chess.prototype._snapshot = function () {
    return {
      board: this.board.map(function (row) {
        return row.map(function (c) { return c ? { type: c.type, color: c.color } : null; });
      }),
      turn: this.turn,
      castling: { w: { K: this.castling.w.K, Q: this.castling.w.Q }, b: { K: this.castling.b.K, Q: this.castling.b.Q } },
      ep: this.ep ? [this.ep[0], this.ep[1]] : null
    };
  };

  Chess.prototype._restore = function (s) {
    this.board = s.board;
    this.turn = s.turn;
    this.castling = s.castling;
    this.ep = s.ep;
  };

  Chess.prototype.getMoves = function () {
    var color = this.turn;
    var moves = [];
    for (var r = 0; r < 8; r++) for (var c = 0; c < 8; c++) {
      var p = this.board[r][c];
      if (p && p.color === color) {
        var pseudo = this._pseudoMoves(r, c);
        for (var i = 0; i < pseudo.length; i++) {
          var m = pseudo[i];
          if (this.rules.noCastling && (m.flags.indexOf('kingside') !== -1 || m.flags.indexOf('queenside') !== -1)) continue;
          var snap = this._snapshot();
          this._applyMove(m);
          var legal = !this.inCheck(color);
          this._restore(snap);
          if (legal) moves.push(m);
        }
      }
    }
    return moves;
  };

  Chess.prototype.findMove = function (move) {
    var moves = this.getMoves();
    for (var i = 0; i < moves.length; i++) {
      var m = moves[i];
      if (m.from === move.from && m.to === move.to &&
        (move.promotion ? m.promotion === move.promotion : !m.promotion)) {
        return m;
      }
    }
    return null;
  };

  Chess.prototype._applyMove = function (move) {
    var frfc = Chess.squareToRC(move.from);
    var trtc = Chess.squareToRC(move.to);
    var fr = frfc[0], fc = frfc[1], tr = trtc[0], tc = trtc[1];
    this.ep = null;
    var piece = this.board[fr][fc];
    this.board[tr][tc] = piece;
    this.board[fr][fc] = null;
    if (move.flags.indexOf('ep') !== -1) this.board[fr][tc] = null;
    if (move.flags.indexOf('kingside') !== -1) { this.board[fr][5] = this.board[fr][7]; this.board[fr][7] = null; }
    if (move.flags.indexOf('queenside') !== -1) { this.board[fr][3] = this.board[fr][0]; this.board[fr][0] = null; }
    if (move.promotion) this.board[tr][tc] = { type: move.promotion, color: piece.color };
    if (move.flags.indexOf('double') !== -1) this.ep = [(fr + tr) / 2, tc];
  };

  Chess.prototype.makeMove = function (move) {
    var matched = this.findMove(move);
    if (!matched) return null;
    var frfc = Chess.squareToRC(matched.from);
    var trtc = Chess.squareToRC(matched.to);
    var fr = frfc[0], fc = frfc[1], tr = trtc[0], tc = trtc[1];
    var piece = this.board[fr][fc];
    var capturedPiece = this.board[tr][tc];

    var entry = {
      move: matched,
      captured: matched.flags.indexOf('ep') !== -1
        ? { type: 'p', color: piece.color === 'w' ? 'b' : 'w' }
        : (capturedPiece ? { type: capturedPiece.type, color: capturedPiece.color } : null),
      castling: { w: { K: this.castling.w.K, Q: this.castling.w.Q }, b: { K: this.castling.b.K, Q: this.castling.b.Q } },
      ep: this.ep ? [this.ep[0], this.ep[1]] : null,
      halfmove: this.halfmove,
      fullmove: this.fullmove
    };
    this.history.push(entry);

    if (piece.type === 'k') this.castling[piece.color] = { K: false, Q: false };
    if (piece.type === 'r') {
      if (fr === 0 && fc === 0) this.castling.w.Q = false;
      else if (fr === 0 && fc === 7) this.castling.w.K = false;
      else if (fr === 7 && fc === 0) this.castling.b.Q = false;
      else if (fr === 7 && fc === 7) this.castling.b.K = false;
    }
    if (capturedPiece && capturedPiece.type === 'r') {
      if (tr === 0 && tc === 0) this.castling.w.Q = false;
      else if (tr === 0 && tc === 7) this.castling.w.K = false;
      else if (tr === 7 && tc === 0) this.castling.b.Q = false;
      else if (tr === 7 && tc === 7) this.castling.b.K = false;
    }

    this._applyMove(matched);

    if (piece.type === 'p' || matched.captured) this.halfmove = 0;
    else this.halfmove++;
    if (piece.color === 'b') this.fullmove++;
    this.turn = piece.color === 'w' ? 'b' : 'w';

    this.positionKeys.push(this.positionKey());
    return matched;
  };

  Chess.prototype.undo = function () {
    var entry = this.history.pop();
    if (!entry) return null;
    this.positionKeys.pop();
    this.castling = entry.castling;
    this.ep = entry.ep;
    this.halfmove = entry.halfmove;
    this.fullmove = entry.fullmove;
    this.turn = entry.move.color;
    var frfc = Chess.squareToRC(entry.move.from);
    var trtc = Chess.squareToRC(entry.move.to);
    var fr = frfc[0], fc = frfc[1], tr = trtc[0], tc = trtc[1];
    var piece = this.board[tr][tc];
    this.board[fr][fc] = piece;
    if (entry.move.flags.indexOf('kingside') !== -1) { this.board[fr][7] = this.board[fr][5]; this.board[fr][5] = null; }
    else if (entry.move.flags.indexOf('queenside') !== -1) { this.board[fr][0] = this.board[fr][3]; this.board[fr][3] = null; }
    if (entry.move.flags.indexOf('ep') !== -1) {
      this.board[tr][tc] = null;
      this.board[fr][tc] = { type: 'p', color: entry.move.color === 'w' ? 'b' : 'w' };
    } else {
      this.board[tr][tc] = entry.captured ? { type: entry.captured.type, color: entry.captured.color } : null;
    }
    if (entry.move.promotion) this.board[fr][fc] = { type: 'p', color: entry.move.color };
    return entry.move;
  };

  Chess.prototype.positionKey = function () {
    var s = this.turn;
    for (var r = 0; r < 8; r++) for (var c = 0; c < 8; c++) {
      var p = this.board[r][c];
      s += p ? p.color + p.type : '.';
    }
    s += (this.castling.w.K ? 'K' : '') + (this.castling.w.Q ? 'Q' : '') + (this.castling.b.K ? 'k' : '') + (this.castling.b.Q ? 'q' : '');
    s += this.ep ? Chess.rcToSquare(this.ep[0], this.ep[1]) : '-';
    return s;
  };

  Chess.prototype.isCheckmate = function () {
    return this.inCheck(this.turn) && this.getMoves().length === 0;
  };

  Chess.prototype.isStalemate = function () {
    return !this.inCheck(this.turn) && this.getMoves().length === 0;
  };

  Chess.prototype._insufficientMaterial = function () {
    var pieces = [];
    for (var r = 0; r < 8; r++) for (var c = 0; c < 8; c++) {
      var p = this.board[r][c];
      if (p) pieces.push({ r: r, c: c, type: p.type, color: p.color });
    }
    var others = pieces.filter(function (p) { return p.type !== 'n' && p.type !== 'b'; });
    if (others.length > 2) return false;
    var minors = pieces.filter(function (p) { return p.type === 'n' || p.type === 'b'; });
    if (minors.length === 0) return true;
    if (minors.length === 1) return true;
    if (minors.length === 2) {
      if (minors[0].type === 'b' && minors[1].type === 'b') {
        return ((minors[0].r + minors[0].c) % 2) === ((minors[1].r + minors[1].c) % 2);
      }
      if (minors[0].type === 'n' && minors[1].type === 'n') return true;
    }
    return false;
  };

  Chess.prototype.isDraw = function () {
    if (this.halfmove >= 100) return true;
    var key = this.positionKey();
    if (this.positionKeys.filter(function (k) { return k === key; }).length >= 3) return true;
    return this._insufficientMaterial();
  };

  Chess.prototype.getStatus = function () {
    if (this.isCheckmate()) return { over: true, result: this.turn === 'w' ? 'b' : 'w', reason: 'checkmate' };
    if (this.isStalemate()) return { over: true, result: 'draw', reason: 'stalemate' };
    if (this.isDraw()) return { over: true, result: 'draw', reason: 'draw' };
    return { over: false, result: null, reason: null };
  };

  Chess.prototype._moveToSAN = function (move) {
    if (move.flags.indexOf('kingside') !== -1) return 'O-O';
    if (move.flags.indexOf('queenside') !== -1) return 'O-O-O';
    var piece = move.piece;
    var san = piece === 'p' ? '' : piece.toUpperCase();
    if (piece !== 'p') {
      var amb = this.getMoves().filter(function (m) {
        return m.piece === piece && m.to === move.to && m.from !== move.from;
      });
      if (amb.length) {
        var sameFile = amb.some(function (m) { return m.from[0] === move.from[0]; });
        var sameRank = amb.some(function (m) { return m.from[1] === move.from[1]; });
        if (!sameFile) san += move.from[0];
        else if (!sameRank) san += move.from[1];
        else san += move.from;
      }
    }
    if (move.captured) {
      if (piece === 'p') san += move.from[0];
      san += 'x';
    }
    san += move.to;
    if (move.promotion) san += '=' + move.promotion.toUpperCase();
    var snap = this._snapshot();
    this._applyMove(move);
    var opp = move.color === 'w' ? 'b' : 'w';
    this.turn = opp;
    if (this.inCheck(opp)) san += this.getMoves().length === 0 ? '#' : '+';
    this._restore(snap);
    return san;
  };

  Chess.prototype.capturedBy = function (color) {
    var res = [];
    for (var i = 0; i < this.history.length; i++) {
      var e = this.history[i];
      if (e.captured && e.captured.color !== color) res.push(e.captured.type);
    }
    return res;
  };

  // 子力分差：正数=白方领先，负数=黑方领先（兵1 马/象3 车5 后9）
  Chess.prototype.materialDiff = function () {
    var values = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
    var w = 0, b = 0;
    for (var r = 0; r < 8; r++) for (var c = 0; c < 8; c++) {
      var p = this.board[r][c];
      if (p) {
        if (p.color === 'w') w += values[p.type];
        else b += values[p.type];
      }
    }
    return w - b;
  };

  global.Chess = Chess;
})(window);