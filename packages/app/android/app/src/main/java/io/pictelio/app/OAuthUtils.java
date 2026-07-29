package io.pictelio.app;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;

/**
 * OAuth 工具方法 — 共享给 AuthPlugin 和 PixivApiPlugin。
 */
public final class OAuthUtils {
  private OAuthUtils() {}

  /** 计算 UTF-8 字符串的 MD5 十六进制摘要。 */
  public static String md5Hex(String input) {
    try {
      MessageDigest md = MessageDigest.getInstance("MD5");
      byte[] digest = md.digest(input.getBytes(StandardCharsets.UTF_8));
      StringBuilder sb = new StringBuilder(32);
      for (byte b : digest) {
        sb.append(String.format("%02x", b & 0xff));
      }
      return sb.toString();
    } catch (NoSuchAlgorithmException e) {
      throw new RuntimeException("MD5 not available", e);
    }
  }

  /** 轻量的 URL 编码（保留字母数字、- _ . *，空格转 +，其余 %XX）。 */
  public static String urlEncode(String s) {
    StringBuilder out = new StringBuilder(s.length());
    for (byte b : s.getBytes(StandardCharsets.UTF_8)) {
      int c = b & 0xff;
      if (c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z'
              || c >= '0' && c <= '9' || c == '-' || c == '_'
              || c == '.' || c == '*') {
        out.append((char) c);
      } else if (c == ' ') {
        out.append('+');
      } else {
        out.append('%').append(String.format("%02X", c));
      }
    }
    return out.toString();
  }

  /** 轻量的 URL 编码表单构建器。 */
  public static class URLSearchParams {
    private final StringBuilder sb = new StringBuilder();

    public URLSearchParams add(String key, String value) {
      if (sb.length() > 0) sb.append('&');
      sb.append(urlEncode(key)).append('=').append(urlEncode(value));
      return this;
    }

    public String build() {
      return sb.toString();
    }
  }
}
