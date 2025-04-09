#!/bin/bash

open -na "Google Chrome" --args --remote-debugging-port=9222 --user-data-dir="$HOME/wallet1"
open -na "Google Chrome" --args --remote-debugging-port=9223 --user-data-dir="$HOME/wallet2"
open -na "Google Chrome" --args --remote-debugging-port=9224 --user-data-dir="$HOME/wallet3"