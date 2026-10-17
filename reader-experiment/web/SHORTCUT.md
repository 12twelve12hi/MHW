# iPhone Shortcut: "Send to Daylight" in the share sheet

With this Shortcut, **Share > Send to Daylight** in Safari (or any app that shares a link) opens the web sender,
which sends the link to your Daylight and shows **Sent ✓**. It takes about five minutes to set up, once. (The Send to
Daylight iPhone app does the same without a Shortcut and also sends whole pages; this is the no-install route.)

The web sender lives at <https://12twelve12hi.github.io/MHW/send/> (or wherever you host
`send-to-daylight-web.zip`; use that address below instead).

## 1. Pair the web sender and copy your Shortcut link

1. On the iPhone, open the web sender in **Safari**.
2. Pair it: type the 28-character code your Daylight shows (Daylight Share), or open the pairing link from the
   Daylight.
3. Tap **Settings** (top right). Under **iPhone Shortcut**, tap **Copy**.

You now have a link like this on the clipboard (yours is longer and has your own code in it):

```
https://12twelve12hi.github.io/MHW/send/#autosend=1&pair=daylightshare%3A%2F%2Fpair%3Fc%3D…&url=
```

It contains your pairing, so the Shortcut keeps working even if Safari clears the site's data. Anyone with it can
send to (and read from) your Daylight's inbox: keep it private and don't share the Shortcut. Everything after `#`
stays on the phone; it is never sent to the web server.

## 2. Make the Shortcut

In the **Shortcuts** app:

1. Tap **+** (top right) to start a new shortcut.
2. Tap its name at the top, choose **Rename**, and call it **Send to Daylight**. (Optional: **Choose Icon**.)
3. Tap the **ⓘ** button at the bottom and switch on **Show in Share Sheet**, then tap **Done**. The shortcut now
   begins with *Receive **Images and 18 more** input from **Share Sheet***.
   - Tap **Images and 18 more**, choose **Clear**, then select **Safari web pages** and **URLs**. Tap **Done**.
   - Below it, tap **Continue** (in *If there's no input*) and choose **Stop and Respond**.
4. Tap **Search for apps and actions** (bottom), search for **Get URLs from Input**, and tap it. It reads
   *Get URLs from **Shortcut Input***.
5. Add **Get Item from List**. It reads *Get **First Item** from **URLs***.
6. Add **URL Encode**. It reads ***Encode** **Item from List***.
7. Add **Text**. Tap inside its box, long-press and **Paste** the link you copied in step 1. Put the cursor at the
   very end (right after `&url=`, no space), then tap **URL Encoded Text** in the bar above the keyboard to insert it
   there.
8. Add **Open URLs**. It reads *Open **Text***.
9. Tap **Done**.

The finished shortcut, top to bottom:

| Action | Reads |
|---|---|
| Receive | Safari web pages and URLs input from Share Sheet; if there's no input: Stop and Respond |
| Get URLs from Input | Get URLs from Shortcut Input |
| Get Item from List | Get First Item from URLs |
| URL Encode | Encode Item from List |
| Text | `https://…/send/#autosend=1&pair=…&url=`**URL Encoded Text** |
| Open URLs | Open Text |

## 3. Use it

In Safari, tap the **Share** button, then **Send to Daylight** in the row of actions (scroll down, or tap **Edit
Actions…** to add it to your favourites). The first time, iOS asks whether the shortcut may open the page: choose
**Always Allow**. Safari opens the web sender, which sends the link and shows **Sent ✓**; switch back to what you
were reading. It works the same from News, Mail and any other app whose share sheet offers a link.

The Daylight Reader downloads the article from its link, so the Shortcut sends the address, not the page as you see
it: pages behind a login may arrive as the login page. To send those whole, use the Send to Daylight app or its
Safari extension.

## If something is off

- **"The pairing in this link didn't work":** copy the link again from Settings (step 1.3) and paste it over the old
  one in the Text action.
- **Nothing happens / no "Sent ✓":** check that the Text action ends in `&url=` followed directly by the blue
  **URL Encoded Text** token, and that **Open URLs** opens that Text.
- **It sent to the wrong Daylight:** the link carries one pairing; if you pair again (or reset pairing on the
  Daylight), copy the new link into the Shortcut.
- **Delivered?** Open the web sender: the history shows **Delivered ✓** once the Daylight has picked an item up. The
  page also re-sends anything the Daylight hasn't confirmed when you open it.
