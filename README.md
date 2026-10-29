# SillyTavern Timelines Extension

![STTL_screenshot](https://github.com/Technologicat/SillyTavern-Timelines/assets/16972251/7fccb43f-b4f6-4e1d-8fdf-3bd68dfb1969)
An extension for timeline based navigation of ST chat histories.

Think *Loom* [[1]](https://generative.ink/posts/loom-interface-to-the-multiverse/) [[2]](https://www.lesswrong.com/posts/bxt7uCiHam4QXrQAA/cyborgism#Appendix__Testimony_of_a_Cyborg), but built on ST's chat paradigm.


## Features

- A top-down tree of the current character's chats. A run of messages with no fork is one row. The same text at the same depth, in any number of files, is one row.
- The open chat is on screen immediately. Other chat files load behind it.
- Search is still a fragment search: whitespace-separated pieces, all of them required, order ignored.
- Graph draws one depth window with positions taken from the message number. It does not run a graph solver over the whole archive.
- Open, fork, edit, and checkpoint from a message. Edit and checkpoint hand the work to SillyTavern.

## Installation and Usage

### Installation

Use ST's inbuilt extension installer.

### Usage

- Settings: *Extensions > Timelines*
- Open the timeline: *Extensions > Timelines > Show Timeline*
- Slash commands:
  - `/tl` opens the timeline
  - `/tl r` drops the in-memory file cache and reads every chat again

The open chat is a column of messages. Another file that shares that text shows up beside the turn where it splits, including a branch that stops at the split and has no further messages of its own. Chats that do not share an opening line stay in the chat menu instead of being drawn on top of this one.

Previous branch and next branch move between forks and checkpoints. Search hides runs that do not contain every fragment. For example, `ear xam oop` matches a message that contains those pieces in any order.

Open uses the open chat when the row is shared by several files. Fork creates a SillyTavern branch. On a swipe that is not the last message of its file, fork is how you reach it, because SillyTavern only keeps swipes on the last message. Edit opens SillyTavern's message editor. Checkpoint asks for a name, opens that message, and creates the checkpoint there. Delete removes a chat file that is not the one currently open, after a confirm that names the file.

### Checkpoints

While checkpoints are a core ST feature, *Timelines* takes them to center stage, so we explain them briefly here.

A checkpoint is just a named chat branch. Branches, including checkpoints, are essentially separate chat files. You may sometimes see the old term *bookmark*, which means *checkpoint*.

*Timelines* itself only creates (unnamed) branches.

Checkpoints are created in the ST main GUI. To create a checkpoint, go to the chat message you want, and then press the *Checkpoint* button in the *Message Actions* for that message. The actions are in the "..." menu, unless you have enabled *Expand Message Actions* in your *User Settings* (advanced mode).

To rename a checkpoint, rename the file in a file manager.

To delete a branch or checkpoint, use ST's built-in *Manage chat files* view, or a file manager. Roughly speaking: delete the chat file that was spawned by the branch or checkpoint, and the branch/checkpoint will be gone.

However, checkpoint tracking complicates things slightly:

- Creating a checkpoint spawns a new chat file (the *checkpoint chat file*), but it also inserts a *checkpoint link* into the originating chat file.
  - The link belongs to a specific message. Each chat message can have at most one checkpoint link.
  - As of ST 1.11.3, checkpoint links cannot be deleted in the GUI (but this does not matter much).
- If you later overwrite a checkpoint, by creating a new one at the same message in the same chat, doing so severs the original link.
  - This does not overwrite the old checkpoint chat file. Only the checkpoint link in the originating chat file is overwritten.
- If you delete or rename the checkpoint chat file, this leaves a dead link in the originating chat file.

*Timelines* tracks checkpoint paths by following checkpoint links, ignoring any dead links. Therefore:

- If you delete or rename a checkpoint chat file, that checkpoint vanishes from the timeline view.
  - A renamed checkpoint chat file appears as an independent chat file in the timeline view (in the full info panel for nodes containing its messages), not connected to any checkpoint.
- If you overwrite a checkpoint, only the **new** checkpoint is tracked as a checkpoint path.
  - The checkpoint chat file for the old checkpoint then appears as an independent chat file in the timeline view.
- The *checkpoint node* in the graph is at the message where the *originating* chat file has the checkpoint link.


## Prerequisites

SillyTavern version >=1.10.4

## Support and Contributions

All feedback and issues welcome.

## License

[MIT](https://github.com/city-unit/SillyTavern-Timelines/blob/master/LICENSE)
