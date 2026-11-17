import React from 'react';
import { Chess, type Square } from 'chess.js';
import { X } from 'lucide-react';
import { ChessPiece } from './ChessPiece';

export interface LegalTargetInfo {
  isCapture: boolean;
  isPromotion: boolean;
}

interface ChessBoardProps {
  fen: string;
  orientation: 'w' | 'b';
  selectedSquare: Square | null;
  legalTargets: Map<Square, LegalTargetInfo>;
  lastMove: { from: string; to: string } | null;
  checkSquare: Square | null;
  disabled?: boolean;
  onSquareClick: (sq: Square) => void;
  pendingPromotion: { from: Square; to: Square; color: 'w' | 'b' } | null;
  onSelectPromotion: (piece: 'q' | 'r' | 'b' | 'n') => void;
  onCancelPromotion: () => void;
}

const PROMOTION_OPTIONS: Array<{ piece: 'q' | 'r' | 'b' | 'n'; label: string }> = [
  { piece: 'q', label: 'Menteri' },
  { piece: 'r', label: 'Benteng' },
  { piece: 'b', label: 'Gajah' },
  { piece: 'n', label: 'Kuda' },
];

export const ChessBoard: React.FC<ChessBoardProps> = ({
  fen,
  orientation,
  selectedSquare,
  legalTargets,
  lastMove,
  checkSquare,
  disabled = false,
  onSquareClick,
  pendingPromotion,
  onSelectPromotion,
  onCancelPromotion,
}) => {
  const chess = new Chess(fen);
  const files = orientation === 'w' ? 'abcdefgh'.split('') : 'hgfedcba'.split('');
  const ranks = orientation === 'w' ? '87654321'.split('') : '12345678'.split('');

  return (
    <div className="relative w-full max-w-[560px] mx-auto select-none">
      <div className="rounded-xl p-2 sm:p-2.5 bg-[#2A1E15] border border-[#493728] shadow-2xl">
        <div
          role="grid"
          aria-label="Papan Catur"
          className="grid grid-cols-8 aspect-square w-full overflow-hidden rounded-[6px] border border-[#1B130D]"
        >
          {ranks.map((rank, rIdx) =>
            files.map((file, fIdx) => {
              const sq = `${file}${rank}` as Square;
              const fileIndex = 'abcdefgh'.indexOf(file);
              const rankIndex = Number(rank);
              const isDark = (fileIndex + rankIndex) % 2 === 0;
              const piece = chess.get(sq);

              const isSelected = selectedSquare === sq;
              const isLastMove = lastMove?.from === sq || lastMove?.to === sq;
              const isCheck = checkSquare === sq;
              const targetInfo = legalTargets.get(sq);

              const showRankCoord = fIdx === 0;
              const showFileCoord = rIdx === 7;

              return (
                <button
                  key={sq}
                  type="button"
                  disabled={disabled}
                  onClick={() => onSquareClick(sq)}
                  aria-label={`Petak ${sq}${piece ? `, ${piece.color === 'w' ? 'Putih' : 'Hitam'} ${piece.type}` : ''}`}
                  className={`relative flex items-center justify-center aspect-square transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#E2B45A] ${
                    isDark ? 'bg-[#9A6B49]' : 'bg-[#EADBC8]'
                  } ${disabled ? 'cursor-default' : 'cursor-pointer'}`}
                >
                  {isLastMove && !isSelected && (
                    <span
                      aria-hidden="true"
                      className="absolute inset-0 bg-[#E2B45A]/35 pointer-events-none"
                    />
                  )}

                  {isSelected && (
                    <span
                      aria-hidden="true"
                      className="absolute inset-0 bg-[#E2B45A]/60 pointer-events-none"
                    />
                  )}

                  {isCheck && (
                    <span
                      aria-hidden="true"
                      className="absolute inset-0 pointer-events-none"
                      style={{
                        background:
                          'radial-gradient(circle, rgba(220,38,38,0.85) 0%, rgba(220,38,38,0.38) 58%, transparent 78%)',
                      }}
                    />
                  )}

                  {showRankCoord && (
                    <span
                      aria-hidden="true"
                      className={`absolute top-0.5 left-1 font-mono text-[10px] leading-none font-semibold pointer-events-none ${
                        isDark ? 'text-[#EADBC8]/80' : 'text-[#6A452B]/85'
                      }`}
                    >
                      {rank}
                    </span>
                  )}

                  {showFileCoord && (
                    <span
                      aria-hidden="true"
                      className={`absolute bottom-0.5 right-1 font-mono text-[10px] leading-none font-semibold pointer-events-none ${
                        isDark ? 'text-[#EADBC8]/80' : 'text-[#6A452B]/85'
                      }`}
                    >
                      {file}
                    </span>
                  )}

                  {piece && (
                    <span
                      className={`relative z-10 w-[82%] h-[82%] transition-transform duration-150 ${
                        isSelected ? 'scale-105' : ''
                      }`}
                    >
                      <ChessPiece color={piece.color} type={piece.type} />
                    </span>
                  )}

                  {targetInfo && !targetInfo.isCapture && (
                    <span
                      aria-hidden="true"
                      className="relative z-20 w-[28%] h-[28%] rounded-full bg-[#1F4E38]/75 pointer-events-none"
                    />
                  )}

                  {targetInfo && targetInfo.isCapture && (
                    <span
                      aria-hidden="true"
                      className="absolute inset-[7%] z-20 rounded-full border-[3.5px] border-[#1F4E38]/80 pointer-events-none"
                    />
                  )}
                </button>
              );
            })
          )}
        </div>
      </div>

      {pendingPromotion && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Pilih Promosi Pion"
          className="absolute inset-0 z-30 flex items-center justify-center rounded-xl bg-[#11161F]/75 backdrop-blur-[2px] p-4"
        >
          <div className="w-full max-w-xs rounded-xl bg-[#1A212E] border border-white/15 p-5 shadow-2xl">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-display text-lg font-semibold text-[#F3EFE6]">Promosi Pion</h3>
              <button
                type="button"
                onClick={onCancelPromotion}
                aria-label="Batal promosi"
                className="p-1.5 rounded-lg text-[#A8B2C1] hover:text-[#F3EFE6] hover:bg-white/10 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2.5">
              {PROMOTION_OPTIONS.map((opt) => (
                <button
                  key={opt.piece}
                  type="button"
                  onClick={() => onSelectPromotion(opt.piece)}
                  className="flex flex-col items-center justify-center gap-1.5 py-3 px-4 rounded-lg bg-[#232B3A] hover:bg-[#2C3648] border border-white/10 hover:border-[#E2B45A]/60 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E2B45A]"
                >
                  <div className="w-10 h-10">
                    <ChessPiece color={pendingPromotion.color} type={opt.piece} />
                  </div>
                  <span className="text-xs font-medium text-[#F3EFE6] whitespace-nowrap">
                    {opt.label}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
