package com.daylight.share.core

import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.io.IOException
import java.io.InputStream
import java.io.OutputStream
import java.io.RandomAccessFile
import java.io.SequenceInputStream
import java.security.MessageDigest
import java.util.Collections
import java.util.Locale
import java.util.zip.Deflater
import java.util.zip.DeflaterOutputStream
import java.util.zip.Inflater
import java.util.zip.InflaterInputStream

/** Bytes to send or bytes received: in memory or in a file, so large documents never have to sit in memory whole. */
interface Body {
    val length: Long
    fun open(): InputStream
    fun read(offset: Long, len: Int): ByteArray
}

class BytesBody(val bytes: ByteArray) : Body {
    override val length: Long get() = bytes.size.toLong()
    override fun open(): InputStream = ByteArrayInputStream(bytes)
    override fun read(offset: Long, len: Int): ByteArray = bytes.copyOfRange(offset.toInt(), offset.toInt() + len)
}

class FileBody(val file: File) : Body {
    override val length: Long get() = file.length()
    override fun open(): InputStream = FileInputStream(file)
    override fun read(offset: Long, len: Int): ByteArray {
        val out = ByteArray(len)
        RandomAccessFile(file, "r").use { raf ->
            raf.seek(offset)
            raf.readFully(out)
        }
        return out
    }

    fun readAll(): ByteArray = file.readBytes()
}

/** What a sender shares: the header fields it chooses. Content goes to [ItemBuilder.prepare] separately. */
data class OutgoingItem(
    val kind: String,
    val id: String = ItemHeader.newId(),
    val url: String? = null,
    val title: String? = null,
    val name: String? = null,
    val mime: String? = null,
    /** ISO time the user shared it; now when null. */
    val sent: String? = null,
    val from: String? = null,
    val app: String? = null,
)

/**
 * An item ready to publish: its header (part 0, as stored in the outbox) and its encoded body. [frame] seals one part
 * with a fresh nonce, so the item can be published again at any time with the same id and header (PROTOCOL 3.3).
 */
class PreparedItem(val header: ItemHeader, val encoded: Body, val chunkSize: Int = Limits.CHUNK) {
    /** The encoded length, fixed when the item is prepared. */
    val encodedLength: Long = encoded.length
    val parts: Int = maxOf(1, ((encodedLength + chunkSize - 1) / chunkSize).toInt())

    fun partHeader(part: Int): ItemHeader = if (parts > 1) header.copy(part = part, parts = parts) else header

    private fun chunkRange(part: Int): Pair<Long, Int> {
        val start = part.toLong() * chunkSize
        val end = minOf(encodedLength, start + chunkSize)
        return start to (end - start).toInt()
    }

    /** The length of part [part]'s frame (without building it). */
    fun frameLength(part: Int): Long {
        val headerLen = Bytes.utf8(Json.write(partHeader(part).toJson(parts > 1))).size
        return (FrameCodec.MAGIC.size + FrameCodec.NONCE_BYTES + 4 + headerLen + chunkRange(part).second + FrameCodec.TAG_BYTES).toLong()
    }

    /** True when any frame goes as an attachment (re-sent after 185 minutes or 12 hours instead of 11 hours). */
    val attachment: Boolean = (0 until parts).any { !FrameCodec.isSmall(frameLength(it)) }

    fun frame(keys: Keys, part: Int, nonce: ByteArray = Bytes.random(FrameCodec.NONCE_BYTES)): ByteArray {
        require(part in 0 until parts) { "no part $part" }
        val (start, len) = chunkRange(part)
        val chunk = if (len == 0) ByteArray(0) else encoded.read(start, len)
        return FrameCodec.encrypt(keys, Purpose.INBOX, partHeader(part).toJson(parts > 1), chunk, nonce)
    }

    fun frames(keys: Keys, nonces: List<ByteArray>? = null): List<ByteArray> =
        (0 until parts).map { i -> nonces?.getOrNull(i)?.let { frame(keys, i, it) } ?: frame(keys, i) }
}

/** Builds [PreparedItem]s from what the user shares (the JS `buildItemFrames`, split so the frames can be rebuilt). */
object ItemBuilder {
    private val TEXT_MIMES = Regex("^(text/|application/(xhtml\\+xml|json|xml|javascript|x-markdown))", RegexOption.IGNORE_CASE)

    fun shouldCompress(mime: String?): Boolean = TEXT_MIMES.containsMatchIn(mime ?: "")

    /**
     * Validates [item], hashes [content] and encodes it (deflate-raw for pages and text types when that is smaller).
     * With a [workDir], a file's encoded form is written there (as `<id>.enc`) instead of held in memory.
     * Content over [Limits.MAX_ITEM] bytes (before compression) is refused before it is read, with
     * [Text.tooBigMessage]; a page over [Limits.MAX_PAGE_HTML] with "send the link instead".
     * Throws [ShareException] ("kind", "id", "url", "content", "too-large").
     */
    fun prepare(
        item: OutgoingItem,
        content: Body?,
        compress: Boolean? = null,
        chunkSize: Int = Limits.CHUNK,
        workDir: File? = null,
        nowMs: Long = System.currentTimeMillis(),
    ): PreparedItem {
        val kind = item.kind
        if (kind !in Kind.ALL) throw ShareException("kind", "unknown kind $kind")
        if (!ItemHeader.isId(item.id)) throw ShareException("id", "bad item id")
        val url = if (!item.url.isNullOrEmpty()) Text.webUrl(item.url) else null
        if ((kind == Kind.URL || kind == Kind.PAGE) && url == null) throw ShareException("url", "That isn’t a web address.")
        val title = Text.cleanTitle(item.title).ifEmpty { null }
        var name: String? = null
        var mime: String? = null
        var size: Long? = null
        var sha: String? = null
        var enc = ItemHeader.ENC_IDENTITY
        var encoded: Body = BytesBody(ByteArray(0))
        if (kind != Kind.URL) {
            if (content == null) throw ShareException("content", "missing content")
            if (kind == Kind.PAGE) {
                mime = "text/html"
                if (content.length > Limits.MAX_PAGE_HTML) throw ShareException("too-large", "The page is too large; send the link instead.")
            } else {
                name = Text.safeFileName(item.name, "document")
                mime = (item.mime?.takeIf { it.isNotEmpty() } ?: "application/octet-stream").lowercase(Locale.ROOT).take(100)
            }
            if (content.length > Limits.MAX_ITEM) throw ShareException("too-large", Text.tooBigMessage(content.length))
            size = content.length
            sha = Bytes.toHex(sha256Of(content))
            encoded = content
            val doCompress = compress ?: (kind == Kind.PAGE || shouldCompress(mime))
            if (doCompress && content.length > 0) {
                val z = deflate(content, workDir?.let { File(it, "${item.id}.enc") })
                if (z.length < content.length) {
                    encoded = z
                    enc = ItemHeader.ENC_DEFLATE_RAW
                } else if (z is FileBody) {
                    z.file.delete()
                }
            }
        }
        val header = ItemHeader(
            id = item.id, kind = kind, url = url, title = title, name = name, mime = mime, size = size, sha256 = sha,
            enc = enc, sent = item.sent ?: Bytes.isoTime(nowMs), from = Text.cleanName(item.from).ifEmpty { null },
            app = item.app?.take(60)?.ifEmpty { null },
        )
        val prepared = PreparedItem(header, encoded, chunkSize)
        if (prepared.parts > Limits.MAX_PARTS) throw ShareException("too-large", "That file is too large to send.")
        return prepared
    }

    /** Convenience for in-memory items (tests, small shares): all frames at once. */
    fun buildFrames(keys: Keys, item: OutgoingItem, content: ByteArray?, compress: Boolean? = null, chunkSize: Int = Limits.CHUNK, nonces: List<ByteArray>? = null): Pair<PreparedItem, List<ByteArray>> {
        val p = prepare(item, content?.let(::BytesBody), compress, chunkSize)
        return p to p.frames(keys, nonces)
    }

    fun sha256Of(body: Body): ByteArray {
        val md = MessageDigest.getInstance("SHA-256")
        body.open().use { input ->
            val buf = ByteArray(64 * 1024)
            while (true) {
                val n = input.read(buf)
                if (n < 0) break
                md.update(buf, 0, n)
            }
        }
        return md.digest()
    }

    /** Raw DEFLATE (RFC 1951, no zlib or gzip wrapper) of [body], into [file] when given, else into memory. */
    fun deflate(body: Body, file: File? = null): Body {
        val deflater = Deflater(Deflater.DEFAULT_COMPRESSION, true)
        try {
            if (file != null) {
                file.parentFile?.mkdirs()
                FileOutputStream(file).use { fos -> deflateTo(body, fos, deflater) }
                return FileBody(file)
            }
            val bos = ByteArrayOutputStream()
            deflateTo(body, bos, deflater)
            return BytesBody(bos.toByteArray())
        } finally {
            deflater.end()
        }
    }

    private fun deflateTo(body: Body, out: OutputStream, deflater: Deflater) {
        val dos = DeflaterOutputStream(out, deflater, 64 * 1024)
        body.open().use { it.copyTo(dos, 64 * 1024) }
        dos.finish()
        dos.flush()
    }
}

/**
 * Collects the parts of items (PROTOCOL 2.3) and returns each item once it is complete, decoded and verified.
 *
 * With a [spoolDir], parts are kept on disk (so an item survives a restart between its parts) and the content of a
 * completed item is written to `spoolDir/<id>.content`; the caller moves or deletes that file. Without one, everything
 * stays in memory (tests, small receivers).
 */
class Reassembler(private val spoolDir: File? = null, private val clock: () -> Long = System::currentTimeMillis) {
    /**
     * A complete, verified item. [header] is part 0's (with `part` 0 and `parts` 1), and carries the Lab [extras] part 0
     * had (LAB-PROTOCOL 2.3), so the Inbox can store them with the item.
     */
    class Completed(val header: ItemHeader, val content: Body) {
        /** The Lab item header fields part 0 carried (`x-cap`, `x-orig`), checked; empty for most items. */
        val extras: Map<String, String> get() = header.extras
    }

    private class Pending(val parts: Int, val chunks: MutableMap<Int, ByteArray>, var header: ItemHeader, val created: Long)

    private val pending = Collections.synchronizedMap(HashMap<String, Pending>())

    /** Adds one opened frame. Returns the completed item, or null while parts are missing. Throws [ShareException]. */
    @Synchronized
    fun add(rawHeader: Map<String, Any?>, body: ByteArray): Completed? {
        val h = ItemHeader.check(rawHeader)
        if (h.kind == Kind.URL) return Completed(h.copy(part = 0, parts = 1, size = null, sha256 = null, enc = ItemHeader.ENC_IDENTITY), BytesBody(ByteArray(0)))
        return if (spoolDir == null) addInMemory(h, body) else addOnDisk(spoolDir, h, body)
    }

    private fun addInMemory(h: ItemHeader, body: ByteArray): Completed? {
        var p = pending[h.id]
        if (p == null || p.parts != h.parts) {
            p = Pending(h.parts, HashMap(), h, clock())
            pending[h.id] = p
        }
        p.chunks[h.part] = body.copyOf()
        if (h.part == 0) p.header = h
        if (p.chunks.size < p.parts) return null
        pending.remove(h.id)
        val streams = (0 until p.parts).map { ByteArrayInputStream(p.chunks.getValue(it)) as InputStream }
        val out = ByteArrayOutputStream()
        decodeVerify(p.header, streams, out)
        return Completed(p.header.copy(part = 0, parts = 1), BytesBody(out.toByteArray()))
    }

    private fun addOnDisk(root: File, h: ItemHeader, body: ByteArray): Completed? {
        val dir = File(root, "parts/${h.id}")
        dir.mkdirs()
        // A different part count means a different encoding of the item: start over (like the JS reassembler).
        dir.listFiles()?.forEach { f ->
            val m = PART_FILE.matchEntire(f.name)
            if (m != null && m.groupValues[1].toInt() != h.parts) f.delete()
        }
        writeAtomically(File(dir, "p${h.parts}-${h.part}.bin"), body)
        val headerFile = File(dir, "header-${h.parts}.json")
        if (h.part == 0 || !headerFile.exists()) writeAtomically(headerFile, Bytes.utf8(Json.write(h.toJson(true))))
        val files = (0 until h.parts).map { File(dir, "p${h.parts}-$it.bin") }
        if (!files.all { it.isFile }) return null
        val header = Json.parseObjectOrNull(headerFile.readText())?.let { runCatching { ItemHeader.check(it) }.getOrNull() } ?: h
        val target = File(root, "${h.id}.content")
        val tmp = File(root, "${h.id}.content.tmp")
        try {
            FileOutputStream(tmp).use { out -> decodeVerify(header, files.map { FileInputStream(it) as InputStream }, out) }
            if (target.exists()) target.delete()
            if (!tmp.renameTo(target)) throw IOException("could not store ${target.name}")
        } finally {
            tmp.delete()
            dir.deleteRecursively()
        }
        return Completed(header.copy(part = 0, parts = 1), FileBody(target))
    }

    /** Whether a part of item [id] is held, waiting for the rest. */
    fun isPending(id: String): Boolean =
        pending.containsKey(id) || (spoolDir != null && ItemHeader.isId(id) && File(spoolDir, "parts/$id").isDirectory)

    /** Forgets item [id]'s held parts (it failed its check, or was given up). */
    @Synchronized
    fun drop(id: String) {
        pending.remove(id)
        if (spoolDir != null && ItemHeader.isId(id)) File(spoolDir, "parts/$id").deleteRecursively()
    }

    /** Forgets incomplete items older than [maxAgeMs] (their parts have long expired on the relay). Returns their ids. */
    @Synchronized
    fun prune(maxAgeMs: Long = Limits.INCOMPLETE_TTL_MS): List<String> {
        val now = clock()
        val out = ArrayList<String>()
        synchronized(pending) {
            val it = pending.entries.iterator()
            while (it.hasNext()) {
                val e = it.next()
                if (now - e.value.created > maxAgeMs) {
                    it.remove()
                    out += e.key
                }
            }
        }
        val root = spoolDir ?: return out
        File(root, "parts").listFiles()?.forEach { d ->
            if (now - d.lastModified() > maxAgeMs) {
                d.deleteRecursively()
                out += d.name
            }
        }
        root.listFiles()?.forEach { f -> if (f.name.endsWith(".content.tmp") && now - f.lastModified() > maxAgeMs) f.delete() }
        return out
    }

    companion object {
        private val PART_FILE = Regex("^p(\\d+)-(\\d+)\\.bin$")

        private fun writeAtomically(f: File, bytes: ByteArray) {
            val tmp = File(f.parentFile, f.name + ".tmp")
            tmp.writeBytes(bytes)
            if (f.exists()) f.delete()
            if (!tmp.renameTo(f)) {
                f.writeBytes(bytes)
                tmp.delete()
            }
        }

        /**
         * Concatenates the encoded chunks, decodes `enc` and writes the content to [out], checking `size` (never writing
         * more than it promises, so a deflate bomb stops early) and `sha256`. Throws [ShareException] "integrity".
         */
        fun decodeVerify(h: ItemHeader, chunks: List<InputStream>, out: OutputStream) {
            val expected = h.size ?: throw ShareException("integrity", "no size")
            val md = MessageDigest.getInstance("SHA-256")
            var total = 0L
            val joined: InputStream = SequenceInputStream(Collections.enumeration(chunks))
            val inflater = if (h.enc == ItemHeader.ENC_DEFLATE_RAW) Inflater(true) else null
            try {
                val input = if (inflater != null) InflaterInputStream(joined, inflater, 64 * 1024) else joined
                input.use {
                    val buf = ByteArray(64 * 1024)
                    while (true) {
                        val n = try {
                            it.read(buf)
                        } catch (e: IOException) {
                            throw ShareException("integrity", "bad deflate data", cause = e)
                        }
                        if (n < 0) break
                        total += n
                        if (total > expected) throw ShareException("integrity", "size mismatch")
                        md.update(buf, 0, n)
                        out.write(buf, 0, n)
                    }
                }
            } finally {
                inflater?.end()
                chunks.forEach { runCatching { it.close() } }
            }
            if (total != expected) throw ShareException("integrity", "size mismatch")
            if (Bytes.toHex(md.digest()) != h.sha256) throw ShareException("integrity", "sha256 mismatch")
        }
    }
}
